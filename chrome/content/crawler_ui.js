/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

/*
 * crawler_ui.js
 */
/**
 * @fileOverview These functions implement the user interface behaviors of the top-level control dialog.
 */

const Cu = Components.utils;

Cu.import( "resource://gre/modules/Services.jsm" );

let crawling = false;

function require( module )
{
    let result = {};
    result.wrappedJSObject = result;
    Services.obs.notifyObservers( result, "abpcrawler-require", module );
    if ( !("exports" in result) )
    {
        Cu.reportError( "crawler_ui require: 'exports' missing from module \"" + module + "\"" );
    }
    return result.exports;
}
let {Instruction} = require( "instruction" );
let {Long_Task} = require( "task" );
let {Crawler} = require( "crawler" );
let {Logger} = require( "logger" );

function onUnload_legacy()
{
    const fields = ["backend-url", "parallel-tabs"];
    fields.forEach(
        function( field )
        {
            let control = document.getElementById( field );
            control.setAttribute( "value", control.value );
        }
    );
}

function getBackendUrl()
{
    let backendUrlTextBox = document.getElementById( "backend-url" );
    return backendUrlTextBox.value;
}

function getParallelTabs()
{
    let parallelTabsTextBox = document.getElementById( "parallel-tabs" );
    return parseInt( parallelTabsTextBox.value );
}

function onAccept()
{
    let backendUrl = getBackendUrl();
    let parallelTabs = getParallelTabs();
    let dialog = document.documentElement;
    let acceptButton = dialog.getButton( "accept" );
    crawling = acceptButton.disabled = true;

    let mainWindow = window.opener;
    if ( !mainWindow || mainWindow.closed )
    {
        alert( "Unable to find the main window, aborting." );
        crawling = acceptButton.disabled = false;
    }
    else
        Crawler.crawl_legacy( backendUrl, parallelTabs, mainWindow, function()
        {
            crawling = acceptButton.disabled = false;
        } );

    return false;
}

function onCancel()
{
    let closingPossible = !crawling;
    if ( !closingPossible )
        alert( "Crawling still in progress." );
    return closingPossible;
}

//-------------------------------------------------------
// New code
//-------------------------------------------------------

var current_crawler = null;
var current_crawl = null;
var go_button;

function loader()
{
    go_button = document.getElementById( "crawl_go" );
}

function onShutdown()
{
    unloader();
}

function unloader()
{
    if ( current_crawler )
    {
        current_crawler.close();
        current_crawler = null;
    }
    if ( current_crawl )
    {
        current_crawl.close();
        current_crawl = null;
    }
}

function start_crawl()
{
    var log = crawler_ui_log;
    log( "Start crawl", false );

    var log_window = new Crawl_Display();

    // Only permissible list is the fixed one.
    var si = document.getElementById( "instructions_tabbox" ).getAttribute( "selectedIndex" );
    if ( si != 2 )
    {
        log_window.log( "Temporary: May only use fixed list. Aborted." );
        return false;
    }
    var browse_list = ["yahoo.com", "ksl.com"];
    var instructions = Instruction.basic( browse_list, storage );

    // Only permissible list is the null one.
    si = document.getElementById( "storage_tabbox" ).getAttribute( "selectedIndex" );
    if ( si != 2 )
    {
        log_window.log( "Temporary: May only use null. Aborted." );
        return false;
    }
    var storage = null;

    let mainWindow = window.opener;
    if ( !mainWindow || mainWindow.closed )
    {
        Cu.reportError( "Unable to find the main window, aborting." );
        log_window.log( "Unable to find the main window, aborting." );
        return false;
    }
    current_crawler = new Crawler( instructions, log_window, mainWindow );
    current_crawl = new Long_Task( current_crawler );
    current_crawl.run();
    return true;
}

/**
 * Constructor for a display object for the crawler.
 */
function Crawl_Display()
{
    this.log_box = document.getElementById( "log_box" );
}

Crawl_Display.prototype.log = function( message )
{
    this.log_box.value += message + "\n";
};

crawler_ui_log = (new Logger( "crawler_ui" )).make_log();

