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
 * @param wnd {nsIDOMWindow}
 * @param node {nsIDOMElement}
 * @param contentType {String}
 * @param location {nsIURI}
 * @param collapse {Boolean} true to force hiding of the node
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

//-------------------------------------------------------
// New code
//-------------------------------------------------------

/**
 * Constructor for a single crawl session. The crawler iterates through each instruction, loading its URL in a tab,
 * running the hooks present in the processor, and storing results accordingly.
 *
 * @param {Generator} instructions
 *      Instruction generator yields a sequence of tuples: URL to crawl, a processor, and storage.
 */
var Crawler = function( instructions, display )
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
     * Logging service.
     * @type {Logger}
     */
    this.logger = new Logger( "Crawler" );
};
exports.Crawler = Crawler;

/**
 * Task generator for the crawler
 */
Crawler.prototype.task = function()
{
    var log = this.logger.make_log( "task" );
    try
    {
        prepare();

        for ( let instruction in this.instructions )
        {
            if ( !("toJSON" in instruction) )
            {
                //noinspection ExceptionCaughtLocallyJS
                throw "Instruction doesn't have 'toJSON' member."
            }
            this.display.log( "Instruction " + instruction.toJSON() );
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
        cleanUp();
    }
};


Crawler.prototype.debug_log = function( msg )
{
    Cu.reportError( "Crawler: " + msg );
};

/**
 * Original crawl function. Kept here for reference during rewrite.
 *
 * @param backendUrl
 * @param parallelTabs
 * @param window
 * @param callback
 */
Crawler.crawl_legacy = function( backendUrl, parallelTabs, window, callback )
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

