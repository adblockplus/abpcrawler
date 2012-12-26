Cu.import( "resource://gre/modules/Services.jsm" );

function abprequire( module )
{
    let result = {};
    result.wrappedJSObject = result;
    Services.obs.notifyObservers( result, "adblockplus-require", module );
    return result.exports;
}

let {Storage} = require( "storage" );
let {Client} = require( "client" );

let {Policy} = abprequire( "contentPolicy" );
let {RequestNotifier} = abprequire( "requestNotifier" );
let {Filter} = abprequire( "filterClasses" );
let {Utils} = abprequire( "utils" );

let origProcessNode = Policy.processNode;

let requestNotifier;
let siteTabs;
let currentTabs;
let currentFilter;

function processNode( wnd, node, contentType, location, collapse )
{
    let result = origProcessNode.apply( this, arguments );
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

function loadSite( site, window, callback )
{
    if ( !site )
        return;

    let tabbrowser = window.gBrowser;
    let tab = tabbrowser.addTab( site );
    let browser = tabbrowser.getBrowserForTab( tab );

    siteTabs.set( browser, site );

    let progressListener = {
        onStateChange: function ( aBrowser, aWebProgress, aRequest, aStateFlags, aStatus )
        {
            if ( browser !== aBrowser )
                return;

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
        loadSite( site, window, function ()
        {
            currentTabs--;
            if ( !sites.length && !currentTabs )
            {
                Storage.finish();
                let requestsFilePath = Storage.requestsFile.path;
                Client.sendRequestsFile( backendUrl, requestsFilePath, function ()
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

let Crawler = exports.Crawler = {};

Crawler.crawl = function ( backendUrl, parallelTabs, window, callback )
{
    if ( !prepare() )
        return;

    Client.fetchCrawlableSites( backendUrl, function ( sites )
    {
        loadSites( backendUrl, parallelTabs, window, sites, function ()
        {
            cleanUp();
            callback();
        } );
    } );
};
