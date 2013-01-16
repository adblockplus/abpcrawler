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
// Shim
//-------------------------------------------------------
/**
 * Manager for shim replacement of an external function.
 * <p/>
 * Since there's no lvalue reference type in JavaScript (non-primitives are all reference types, but they are rvalue
 * references), the arguments here provide a substitute. The reference is the expression 'object[ property ]'.
 *
 * @param {Object} original_object
 *      The original function whose call and return are to be surrounded by the shim.
 * @param {String} original_property
 *      The original function whose call and return are to be surrounded by the shim.
 * @constructor
 */
var Shim = function( original_object, original_property )
{
    /**
     * @type {Object}
     */
    this.original_object = original_object;
    /**
     * @type {String}
     */
    this.original_property = original_property;

    /**
     * The original function as it exists at the time of instantiation. This means that generally the Shim instance
     * should be created as soon as possible, such as in module initialization.
     */
    this.original_function = original_object[ original_property ];
};

/**
 * @return {boolean}
 */
Shim.prototype.is_original = function()
{
    return (this.original_object[ this.original_property ] === this.original_function);
};

/**
 *
 * @param {Function} replacer
 *      The replacement function transformer. Takes the original function as an argument and returns its replacement.
 */
Shim.prototype.replace = function( replacer )
{
    if ( !replacer )
        return;
    if ( !this.is_original() )
        throw "This version of Shim does not support multiple replacement.";
    this.original_object[ this.original_property ] = replacer( this.original_function );
    return this.original_function;
};

/**
 * Reset the original function to a non-replaced state.
 * <p/>
 * May be called correctly even if the original has never been replaced.
 */
Shim.prototype.reset = function()
{
    this.original_object[ this.original_property ] = this.original_function;
};

/**
 * Close out the shim and release resources.
 */
Shim.prototype.close = function()
{
    this.reset();
    /*
     * At present, this class does not use external resources that aren't dealt with by 'reset()'. That could change,
     * however, and so we use close() as the substitute-destructor and reset() for ordinary use.
     */
};

/**
 * Shim instance for 'processNode'. As of this writing it's the only function in ABP we're shimming.
 */
var process_node_shim = new Shim( Policy, "processNode" );

//-------------------------------------------------------
// Crawler
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

    if ( !process_node_shim.is_original() )
        throw "Function 'processNode' is already shimmed. We may not insert a second one.";
    process_node_shim.replace(
        function( original )
        {
            return this.node_action.bind( this, original );
        }.bind( this )
    );

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

    /**
     * @type {RequestNotifier}
     */
    this.requestNotifier = new RequestNotifier( null, this.node_entry_action.bind( this ) );

    /**
     * The current nodes that are active in a call to 'node_action'. In ordinary cases, this map has at most the
     * maximum number of concurrent loads.
     * @type {WeakMap}
     */
    this.current_nodes = new WeakMap();
};
exports.Crawler = Crawler;

/**
 * Close the present instance. This object holds browser resources because of the browser tabs it holds open.
 */
Crawler.prototype.close = function()
{
    if ( this.tabbed_browser ) this.tabbed_browser.close();
    if ( this.requestNotifier ) this.requestNotifier.shutdown();
    process_node_shim.reset();
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
        var now = new Date();
        Cu.reportError( "Crawler / load end:" + now.toUTCString() + "." + now.getUTCMilliseconds().toString() );

        if ( !loading )
        {
            Components.utils.reportError( "Crawler/task: not loading upon landing." );
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
                tab.instruction = instruction;

                var now = new Date();
                Cu.reportError( "Crawler / load begin: " + now.toUTCString() + "." + now.getUTCMilliseconds().toString() );

                tab.load( instruction.target ).go( land.bind( this, tab ), null );
                loading = true;
                pause();
            }

            var cancelled = yield false;
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
        this.close();
    }
};

/**
 * Shim for 'processNode' in ABP. Executes once for each node that ABP processes, whether or not it acts on that node.
 *
 * @param {Function} original_f
 *      The original processNode function.
 * @param {nsIDOMWindow} wnd
 * @param {nsIDOMElement} node
 * @param {String} contentType
 * @param {nsIURI} location
 * @param  {Boolean} collapse
 *      true to force hiding of the node
 * @return {Boolean} false if the node should be blocked
 */
Crawler.prototype.node_action = function( original_f, wnd, node, contentType, location, collapse )
{
    var log = this.logger.make_log( "node_action" );
    let entry_log = this.logger.make_log( "node_entry_hook" );

    var entries = [];
    var entry_hook = function( node, window, entry )
    {
        entries.push( { node: node, window: window, entry: entry } );

        let s = "window: ";
        s += window ? window.toString() : "null";
        s += " node: ";
        s += node ? node.toString() : "null";
        s += " entry: ";
        s += "[filter.text=" + entry.filter.text + "]";
        entry_log( s );

    };
    this.current_nodes.set( node, entry_hook );
    // If the original processNode throws, then we will too.
    var result = original_f( wnd, node, contentType, location, collapse );
    if ( entries.length == 0 )
    {
        // Assert we didn't touch this node.
        return true;
    }
    var url_location = (contentType === Policy.type.ELEMHIDE) ? location.text : location.spec;
    log( ">>>>> begin filtered, location: " + url_location );
    /*
     * We need to locate our tab, if any, that the present node arrives from, so that we can tie it to one
     * of the active instructions. So first we find the browser associated with the node, then we locate our own
     * tab object, and from that we have an instruction.
     */
    try
    {
        var browser = locate_browser( wnd );
    }
    catch ( e )
    {
        Cu.reportError( "Crawler.node_action: Error locating browser. '" + e.toString() + "'." );
        this.current_nodes.delete( node );
        return result;
    }
    try
    {
        if ( !this.tabbed_browser.map_browser_to_child.has( browser ) )
        {
            Cu.reportError( "Crawler.node_action: Browser not found in internal map." );
            return result;
        }
        var tab = this.tabbed_browser.map_browser_to_child.get( browser ).child;
        if ( !("instruction" in tab) )
        {
            Cu.reportError( "Crawler.node_action: 'instruction' member not found in tab." );
        }
        var instruction = tab.instruction;
        /*
         * Now that we have an instruction, we
         */
        var observation = {
            filtered: !result,
            content_type: contentType,
            location: url_location,
            entries: entries
        };
        log( observation.toString() );
        instruction.observations.push( observation );
        log( "===== end filtered" );
    }
    catch ( e )
    {
        log( "error: " + e.toString() );
    }
    finally
    {
        return result;
    }
};

function locate_browser( window )
{
    let topWindow = window.top;
    if ( !topWindow.document )
        throw "No document associated with the node's top window";
    let tabbrowser = Utils.getChromeWindow( topWindow ).gBrowser;
    if ( !tabbrowser )
        throw "Unable to get a tabbrowser reference";
    let browser = tabbrowser.getBrowserForDocument( topWindow.document );
    if ( !browser )
        throw "Unable to get browser for the tab";
    return browser;
}

/**
 * This function executes solely underneath (in the call stack) 'node_action'. It receives at least one call per node,
 * more if there are matches on rules of any kind.
 *
 * @param window
 * @param node
 * @param {RequestEntry} entry
 */
Crawler.prototype.node_entry_action = function( window, node, entry )
{
    if ( !this.current_nodes.has( node ) )
    {
        Cu.reportError( "node_entry_action: node not seen in 'current_nodes'" );
    }
    if ( !entry.filter )
    {
        /*
         * If there's no filter in the entry, then nothing happened to it. We are presently ignoring such entries. In
         * the future, however, we will likely want a hook here to process entries that are not associated with any
         * filter, for example, to ensure that necessary content is not blocked inadvertently.
         */
        return;
    }
    this.current_nodes.get( node )( node, window, entry );
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

function onShutdown()
{
    process_node_shim.close();
};
