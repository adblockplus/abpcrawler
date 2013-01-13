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
let {Browser_Tab,Tabbed_Browser} = require( "browser" );
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

    this.tabbed_browser = new Tabbed_Browser( this.window, 1 );

    /**
     * Closed flag. Needed to terminate the generator if this object is closed before the generator stops.
     * @type {Boolean}
     */
    this.closed = false;

};
exports.Crawler = Crawler;

/**
 * Close the present instance. This object holds browser resources because of the browser tabs it holds open.
 */
Crawler.prototype.close = function()
{
    if ( this.tabbed_browser ) this.tabbed_browser.close();
    this.closed = true;
};

/**
 * Task generator for the crawler
 *
 * @param {Function} pause
 * @param {Function} resume
 */
Crawler.prototype.generator = function( pause, resume )
{
    var log = this.logger.make_log( "task" );
    var tab = null;
    var loading = false;

    /**
     * There's a tab argument here because this is destined not to be an inner function. Right now 'loading' is required
     * for this function to work.
     *
     * @param tab
     * @param success
     */
    var land = function( tab, success )
    {
        if ( !loading )
        {
            Components.utils.reportError( "Crawler/task: not loading upon landing." )
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

        for ( let instruction of this.instructions )
        {

            if ( this.closed )
                //noinspection ExceptionCaughtLocallyJS
                throw StopIteration;

            if ( !("to_JSON_value" in instruction) )
            {
                //noinspection ExceptionCaughtLocallyJS
                throw "Instruction doesn't have 'to_JSON_value' member."
            }
            this.display.log( "Instruction " + instruction.to_JSON_value() );

            if ( !loading )
            {
                // BEGIN TEMPORARY: Check to ensure that there's a request available.
                // Once there are no errors in the log for this, we can eliminate our own flag.
                if ( !this.tabbed_browser.available() )
                {
                    Cu.reportError( "tabbed_browser not reporting itself available when it should be." )
                }
                // END TEMPORARY

                var leave_open = true;
                tab = this.tabbed_browser.make_tab( leave_open );
                tab.load( instruction.target ).go( land.bind( this, tab ), null );
                loading = true;
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

