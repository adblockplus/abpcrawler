Cu.import( "resource://gre/modules/Services.jsm" );

function abprequire( module )
{
    let result = {};
    result.wrappedJSObject = result;
    Services.obs.notifyObservers( result, "adblockplus-require", module );
    return result.exports;
}

//let {Storage} = require( "storage" );
// Stub out legacy storage for the moment.
var Storage = {
    write: function( something )
    {
        something.toString();
    }
};

let {Client} = require( "client" );
let {Logger} = require( "logger" );

let {Policy} = abprequire( "contentPolicy" );
let {RequestNotifier} = abprequire( "requestNotifier" );
let {Filter} = abprequire( "filterClasses" );
let {Utils} = abprequire( "utils" );

let origProcessNode = Policy.processNode;

let requestNotifier;
let siteTabs;
let currentTabs;
let currentFilter;

/**
 * Shim for 'processNode' in ABP.
 *
 * @param {nsIDOMWindow} wnd
 * @param {nsIDOMElement} node
 * @param {String} contentType
 * @param {nsIURI} location
 * @param  {Boolean} collapse
 *      true to force hiding of the node
 * @return {Boolean} false if the node should be blocked
 */
function processNode( wnd, node, contentType, location, collapse )
{
    let result = origProcessNode.apply( this, arguments );
    try
    {
        let url = (contentType === Policy.type.ELEMHIDE) ? location.text :
            location.spec;

        let topWindow = wnd.top;
        if ( !topWindow.document )
        {
            Cu.reportError( "No document associated with the node's top window" );
            return result;
        }

        let tabbrowser = Utils.getChromeWindow( topWindow ).gBrowser;
        if ( !tabbrowser )
        {
            Cu.reportError( "Unable to get a tabbrowser reference" );
            return result;
        }

        let browser = tabbrowser.getBrowserForDocument( topWindow.document );
        if ( !browser )
        {
            Cu.reportError( "Unable to get browser for the tab" );
            return result;
        }

        let site = siteTabs.get( browser );
        let filtered = !result;
        let data = [url, site, filtered];
        if ( currentFilter )
        {
            data.push( currentFilter );
            currentFilter = null;
        }
        Storage.write( data );
    }
    catch ( e )
    {
    }
    return result;
}

function handleFilterHit( wnd, node, data )
{
    if ( data.filter )
        currentFilter = data.filter.text;
}

function prepare()
{
    if ( Policy.processNode != origProcessNode )
        return false;

    Policy.processNode = processNode;

    requestNotifier = new RequestNotifier( null, handleFilterHit );
    siteTabs = new WeakMap();
    currentTabs = 0;

    Storage.init();

    return true;
}

/**
 *
 * @param {String} site
 * @param {Window} window
 * @param {Function} callback
 */
function loadSite( site, window, callback )
{
    if ( !site )
        return;

    let tabbrowser = window.gBrowser;
    let tab = tabbrowser.addTab( site );
    let browser = tabbrowser.getBrowserForTab( tab );

    siteTabs.set( browser, site );

    let progressListener = {
        onStateChange: function( aBrowser, aWebProgress, aRequest, aStateFlags, aStatus )
        {
            if ( browser !== aBrowser )
                return;

            //noinspection JSBitwiseOperatorUsage
            if ( !(aStateFlags & Ci.nsIWebProgressListener.STATE_STOP) )
                return;

            tabbrowser.removeTabsProgressListener( progressListener );
            tabbrowser.removeTab( tab );
            callback();
        }
    };
    tabbrowser.addTabsProgressListener( progressListener );
}

function loadSites( backendUrl, parallelTabs, window, sites, callback )
{
    while ( currentTabs < parallelTabs && sites.length )
    {
        currentTabs++;
        let site = sites.shift();
        loadSite( site, window, function()
        {
            currentTabs--;
            if ( !sites.length && !currentTabs )
            {
                Storage.finish();
                let requestsFilePath = Storage.requestsFile.path;
                Client.sendRequestsFile( backendUrl, requestsFilePath, function()
                {
                    Storage.destroy();
                    callback();
                } );
            }
            else
                loadSites( backendUrl, parallelTabs, window, sites, callback );
        } );
    }
}

function cleanUp()
{
    Policy.processNode = origProcessNode;
    siteTabs = null;
}

/**
 * Original crawl function. Kept here for reference during rewrite.
 *
 * @param backendUrl
 * @param parallelTabs
 * @param window
 * @param callback
 */
exports.crawl_legacy = function( backendUrl, parallelTabs, window, callback )
{
    if ( !prepare() )
        return;

    Client.fetchCrawlableSites( backendUrl, function( sites )
    {
        loadSites( backendUrl, parallelTabs, window, sites, function()
        {
            cleanUp();
            callback();
        } );
    } );
};

//-------------------------------------------------------
// New code
//-------------------------------------------------------
/**
 * Constructor for a single crawl session. The crawler iterates through each instruction, loading its URL in a tab,
 * running the hooks present in the processor, and storing results accordingly.
 *
 * @param {Generator} instructions
 *      Instruction generator yields a sequence of tuples: URL to crawl, a processor, and storage.
 * @param {*} display
 * @param {Window} window
 *      The top window we're operating it. Must be present as an argument because the module context this class is
 *      defined in does not have a window. (Or at least should not be relied upon.)
 */
var Crawler = function( instructions, display, window )
{
    this.instructions = instructions;

    if ( !display )
    {
        throw "No ability to provide a null display object"
    }
    /**
     * Display object for showing progress messages.
     * @type {*}
     */
    this.display = display;

    /**
     * Browser window in which to open tabs.
     * @type {Window}
     */
    this.window = window;

    /**
     * Logging service.
     * @type {Logger}
     */
    this.logger = new Logger( "Crawler" );
};
exports.Crawler = Crawler;

/**
 * Task generator for the crawler
 *
 * @param {Function} pause
 * @param {Function} resume
 */
Crawler.prototype.generator = function( pause, resume )
{
    var log = this.logger.make_log( "task" );

    var tab_count = 0;

    var loading = false;

    var land = function( tab, success )
    {
        if ( !loading )
        {
            Cu.reportError( "Crawler/task: not loading upon landing." )
        }
        this.display.log( "page loaded" );
        tab.close();
        loading = false;
        resume();
    };

    var error = function( e )
    {
        Cu.reportError( "Crawler/task: Unexpected exception: " + e.toString() );
    };

    try
    {
        /*
         * Preparation code. Ensure that every initialization here can be reversed in the 'finally' clause whether
         * or not it executed, in case some initialization throws an exception.
         */
        // Add the ABP shim here.

        for ( let instruction in this.instructions )
        {
            if ( !("to_JSON_value" in instruction) )
            {
                //noinspection ExceptionCaughtLocallyJS
                throw "Instruction doesn't have 'to_JSON_value' member."
            }
            this.display.log( "Instruction " + instruction.to_JSON_value() );

            if ( !loading )
            {
                var tab = new Browser_Tab( this.window );
                tab.load( instruction.target ).go( land.bind( this, tab ), null );
                loading = true;
                ++tab_count;
                pause();
            }

            var cancelled = yield( false );
            if ( cancelled )
            {
                this.display.log( "Cancelled" );
                break;
            }
        }
    }
    catch ( e )
    {
        log( e.toString() );
    }
    finally
    {
        /*
         * If everything goes right, this cleanup should not be necessary, as tab instances are closed as they are used.
         * Nonetheless, if there's an error and a landing function is not called, this line ensures that all the tabs
         * are properly destroyed.
         */
        if ( tab ) tab.close();
        // Remove the ABP shim here.
    }
};


Crawler.prototype.debug_log = function( msg )
{
    Cu.reportError( "Crawler: " + msg );
};

/**
 * The default processor performs the legacy scan of the page.
 */
exports.default_operation = function()
{
};

/**
 * Stub functions
 */
Storage.write = function()
{
};
Storage.init = function()
{
};

/**
 * A single browser tab that can asynchronously load a web page.
 *
 * @param {Window} window
 * @param {Boolean} [leave_open=false]
 *      Leave the tab open in the browser after closing the present object
 * @constructor
 */
Browser_Tab = function( window, leave_open )
{
    /**
     * Browser window.
     * @type {Window}
     */
    this.window = window;

    /**
     * Leave the tab open in the browser after the crawler exits. The reason to do this is to allow manual inspection
     * of the window as the crawler loaded it.
     * <p/>
     * It's necessary to call 'close()' on any instance of this object in order to ensure event handlers are released.
     * This is true whether or not the tab remains open afterwards.
     *
     * @type {Boolean}
     */
    this.leave_open = (arguments.length >= 2) ? leave_open : true;

    /**
     * A browser object that can hold multiple individual tabbed browser panes.
     */
    this.tabbed_browser = this.window.gBrowser;

    /**
     * Our tab within the tabbed browser. This is the "external" view of browser pane, the one that allows us to
     * control loading. The tab must have a URL associated with it, so it's not displayed at the outset
     * <p/>
     * FUTURE: Might it be useful to load the tab with a empty page but descriptive title at construction time?
     */
    this.tab = null;

    /**
     * Bound listener function for progress events. This function is null if has not been added as a progress-listener.
     * @type {*}
     */
    this.listener = null;

    /**
     * The function to be run upon completion of an asynchronous load.
     * @type {Function}
     */
    this.finally_f = null;

    /**
     * The function to be run if there's an exceptional termination to an asynchronous load.
     * @type {Function}
     */
    this.catch_f = null;

    /**
     * STATE
     */
    this.state = Browser_Tab.STATE.CREATED;
};

Browser_Tab.STATE = {
    // Initial state
    CREATED: 0,
    // Nonterminal states
    LOADING: 1,
    // Terminal states
    DISPLAYED: 2,
    ERROR: 3,
    CLOSED: 4
};

/**
 * Predicate "is the Browser_Tab in an initial state for its page load?"
 *
 * @return {Boolean}
 */
Browser_Tab.prototype.in_initial_state = function()
{
    return this.state == Browser_Tab.STATE.CREATED;
};

/**
 * Predicate "is this object in a final state for its page load?"
 * <p/>
 * The CLOSED state is considered a final state, although it's present to implement the moral equivalent of a
 * destructor correctly.
 *
 * @return {Boolean}
 */
Browser_Tab.prototype.in_final_state = function()
{
    return this.state >= Browser_Tab.STATE.DISPLAYED;
};

/**
 * Close function destroys our allocated host resources, such as tabs, listeners, requests, etc.
 */
Browser_Tab.prototype.close = function()
{
    if ( this.state == Browser_Tab.STATE.CLOSED )
        return;

    if ( this.listener )
    {
        this.tabbed_browser.removeTabsProgressListener( this.listener );
        this.listener = null;
    }
    if ( this.tab )
    {
        if ( !this.leave_open )
        {
            this.tabbed_browser.removeTab( this.tab );
        }
        this.tab = null;
    }
    /*
     * Cancel any pending page load here.
     */
    this.state = Browser_Tab.STATE.CLOSED;
};

/**
 * Return an asynchronous action that loads a target into a new tab.
 */
Browser_Tab.prototype.load = function( target )
{
    return {
        go: function( finally_f, catch_f )
        {
            this.finally_f = finally_f;
            this.catch_f = catch_f;
            this._show( target );
        }.bind( this )
    };
};

/**
 * Show the tab by loading a URL target into it.
 *
 * @param {String} target
 */
Browser_Tab.prototype._show = function( target )
{
    try
    {
        // Add the listener first, in case the STOP event happens immediately upon adding the tab.
        this.listener = { onStateChange: this._progress.bind( this ) };
        this.tabbed_browser.addTabsProgressListener( this.listener );
        this.tab = this.tabbed_browser.addTab( target );
        this.browser = this.tabbed_browser.getBrowserForTab( this.tab );
    }
    catch ( e )
    {
        this.state = Browser_Tab.STATE.ERROR;
        Cu.reportError( "Unexpected exception in Browser_Tab.show(): " + e.toString() );
        if ( this.catch_f ) this.catch_f( e );
        if ( this.finally_f ) this.finally_f( false );
    }
};

/**
 * Progress event handler. It looks only for STOP states on the present tab. When that happens, it determines the
 * success status and calls the landing function.
 *
 * @param {*} browser
 * @param {nsIWebProgress} controller
 *      The control object for progress monitoring that dispatches the event.
 * @param {nsIRequest} browse_request
 *      The request object generated by the called to addTab(), which loads a page.
 * @param state
 *      The progress state, represented as flags.
 * @param stop_status
 *      Status code for success or failure if the argument state is a STOP state.
 */
Browser_Tab.prototype._progress = function( browser, controller, browse_request, state, stop_status )
{
    /*
     * This check ensures that we only call 'finally_f' once. The browser will send multiple STOP events when the user
     * focuses on a tab window by clicking on its tab. Since we set a final state if we accept the event below, checking
     * for a final state ensures that we act idempotently.
     *
     * This check also forestalls a race condition where a request completes and schedules a progress event while we are
     * closing the object.
     */
    if ( this.in_final_state() )
        return;

    /*
     * Filter out events on other tabs.
     * <p/>
     * Note that this filtering algorithm requires N^2 dispatching progress events, since each tab has its own
     * listener but receives events for each tab. It would be better for code hygiene and resilience against host
     * defects to have a parent class with a single, persistent event handler that dispatched to us here.
     */
    if ( this.browser !== browser )
        return;

    /*
     * We only care about STOP states. We're not tracking redirects, which is one of the progress states possible.
     * We may want to in the future, though, in case redirect behavior is involved with ad delivery in some way.
     */
    //noinspection JSBitwiseOperatorUsage
    if ( !(state & Ci.nsIWebProgressListener.STATE_STOP) )
        return;

    var success = (stop_status == 0 );
    if ( success )
    {
        this.state = Browser_Tab.STATE.DISPLAYED;
    }
    else
    {
        this.state = Browser_Tab.STATE.ERROR;
        /**
         * This argument is an XPCOM 'nsresult' value. It could be examined if the cause of the failure to load needs
         * to be diagnosed. For example, NS_ERROR_OFFLINE would be useful for suspending operation of the crawler while
         * internet connectivity comes back. NS_ERROR_MALFORMED_URI would be useful for notifing the user of a typo.
         */
        this.error_code = stop_status;
    }
    if ( this.finally_f ) this.finally_f( success );
};
