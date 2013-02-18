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
let {Storage} = require( "storage" );
let {Instruction, Instruction_Set} = require( "instruction" );
let {Long_Task} = require( "task" );
let {Crawler} = require( "crawler" );
let {Logger} = require( "logger" );

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

function leave_open()
{
    return document.getElementById( "leave_open" ).checked;
}

function start_crawl()
{
    var log = crawler_ui_log;
    log( "Start crawl", false );

    var log_window = new Crawl_Display();
    var log_to_textbox = new Storage.Display_Log( log_window );

    // Only permissible input is the fixed one.
    var si = document.getElementById( "instructions_tabbox" ).getAttribute( "selectedIndex" );
    if ( si != 2 )
    {
        log_window.log( "Temporary: May only use fixed list. Aborted." );
        return false;
    }
    var browse_list = ["yahoo.com", "ksl.com"];

    var encoding = null;
    switch ( document.getElementById( "format" ).selectedIndex )
    {
        case 0:
            encoding = "JSON";
            break;
        case 1:
            encoding = "YAML";
            break;
        default:
            log_window.log( "Unknown output encoding. Aborted." );
            return false;
    }

    // Only permissible storage is the null one.
    si = document.getElementById( "storage_tabbox" ).getAttribute( "selectedIndex" );
    if ( si != 2 )
    {
        log_window.log( "Temporary: May only use null. Aborted." );
        return false;
    }
    var storage = new Storage.Multiple( [ log_to_textbox, new Storage.Bit_Bucket()], true );
    var instructions = new Instruction_Set.Basic( "Two-site tester", browse_list );

    let mainWindow = window.opener;
    if ( !mainWindow || mainWindow.closed )
    {
        Cu.reportError( "Unable to find the main window, aborting." );
        log_window.log( "Unable to find the main window, aborting." );
        return false;
    }
    current_crawler = new Crawler( instructions, storage, log_window, mainWindow, leave_open() );
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

Crawl_Display.prototype.write = function( message )
{
    this.log_box.value += message;
};

crawler_ui_log = (new Logger( "crawler_ui" )).make_log();

