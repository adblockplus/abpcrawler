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
const Cc = Components.classes;
const Ci = Components.interfaces;

Cu.import( "resource://gre/modules/Services.jsm" );
Cu.import( "resource://gre/modules/FileUtils.jsm" );

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
var preference_service, preference_branch;
var go_button;
var base_name, base_name_initial_value;
var output_directory, output_directory_initial_value;
var save_output_in_preferences, save_output_in_preferences_initial_value;

function loader()
{
    go_button = document.getElementById( "crawl_go" );
    preference_service = Cc["@mozilla.org/preferences-service;1"].getService( Ci.nsIPrefService );
    preference_branch = preference_service.getBranch( "extensions.abpcrawler." );

    /*
     * Set up the output directory values and preferences.
     */
    base_name = document.getElementById( "base_name" );
    output_directory = document.getElementById( "output_directory" );
    save_output_in_preferences = document.getElementById( "save_output_in_preferences" );

    base_name_initial_value = base_name.value;
    if ( preference_branch.prefHasUserValue( "base_name" ) )
    {
        base_name_initial_value = preference_branch.getCharPref( "base_name" );
        base_name.value = base_name_initial_value;
    }
    else
    {
        base_name_initial_value = base_name.value;
    }
    if ( preference_branch.prefHasUserValue( "output_directory" ) )
    {
        output_directory_initial_value = preference_branch.getCharPref( "output_directory" );
        output_directory.value = output_directory_initial_value;
    }
    else
    {
        output_directory_initial_value = "";
        var dir = FileUtils.getDir( "Home", [] );
        output_directory.value = dir.path;
    }
    if ( preference_branch.prefHasUserValue( "save_output_location" ) )
    {
        save_output_in_preferences_initial_value = preference_branch.getCharPref( "save_output_location" );
        save_output_in_preferences.checked = save_output_in_preferences_initial_value;
    }
    else
    {
        save_output_in_preferences_initial_value = false;
    }

    document.getElementById( "output_directory_icon" ).addEventListener( "click", icon_click );
}

//noinspection JSUnusedGlobalSymbols
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

function icon_click()
{
    var fp = Cc["@mozilla.org/filepicker;1"].createInstance( Ci.nsIFilePicker );
    fp.init( window, "Select a File", Ci.nsIFilePicker.modeGetFolder );
    var result = fp.show();
    switch ( result )
    {
        case Ci.nsIFilePicker.returnOK:
            output_directory.value = fp.file.path;
            break;
        case Ci.nsIFilePicker.returnCancel:
            break;
        case Ci.nsIFilePicker.returnReplace:
            break;
        default:
            break;
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

    /*
     * Save preferences automatically when we start a crawl.
     */
    if ( save_output_in_preferences.checked || save_output_in_preferences_initial_value )
    {
        var saving_basename = ( base_name_initial_value != base_name.value );
        var saving_dir = ( output_directory.value != output_directory_initial_value );
        var saving_saving = ( save_output_in_preferences.checked != save_output_in_preferences_initial_value );
        if ( saving_basename )
        {
            preference_branch.setCharPref( "base_name", base_name.value );
        }
        if ( saving_dir )
        {
            preference_branch.setCharPref( "output_directory", output_directory.value );
        }
        if ( saving_saving )
        {
            preference_branch.setCharPref( "save_output_location", save_output_in_preferences.checked );
        }
        if ( saving_basename || saving_dir || saving_saving )
        {
            preference_service.savePrefFile( null );
            /*
             * Recalculate initial values only when saving.
             * DEFECT: Works when save_output_in_preferences is checked, but can fail when it's not.
             */
            base_name_initial_value = base_name.value;
            output_directory_initial_value = output_directory.value;
            save_output_in_preferences_initial_value = save_output_in_preferences.checked;
        }
    }

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

    var encoding = null, suffix = "";
    switch ( document.getElementById( "format" ).selectedIndex )
    {
        case 0:
            encoding = "JSON";
            suffix = ".json";
            break;
        case 1:
            encoding = "YAML";
            suffix = ".yaml";
            break;
        default:
            log_window.log( "Unknown output encoding. Aborted." );
            return false;
    }

    /*
     * Outputs
     */
    var outputs = [
        { storage: log_to_textbox, encode: "YAML" }
    ];
    si = document.getElementById( "storage_tabbox" ).selectedIndex;
    switch ( si )
    {
        case 0:
            log_window.log( "Server storage not supported at present. Aborted." );
            return false;
        case 1:
            var file = Cc["@mozilla.org/file/local;1"].createInstance( Ci.nsILocalFile );
            file.initWithPath( output_directory.value );
            file.append( base_name.value + "-" + filename_timestamp() + suffix );
            log_window.log( "Computed file name = " + file.path );
            outputs.push( { storage: new Storage.Local_File( file ), encode: encoding } );
            break;
        case 2:
            /*
             * This is in at present to ensure that the JSON encoder does not unexpectedly throw. We can take it out
             * when we're assured that it doesn't.
             */
            outputs.push( { storage: new Storage.Bit_Bucket(), encode: "JSON" } );
            break;
        default:
            log_window.log( "WTF? Unknown storage tab. Aborted. si=" + si );
            return false;
    }
    var instructions = new Instruction_Set.Basic( "Two-site tester", browse_list );

    let mainWindow = window.opener;
    if ( !mainWindow || mainWindow.closed )
    {
        Cu.reportError( "Unable to find the main window, aborting." );
        log_window.log( "Unable to find the main window, aborting." );
        return false;
    }
    current_crawler = new Crawler( instructions, outputs, log_window, mainWindow, leave_open() );
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

function filename_timestamp()
{
    var s = Logger.timestamp();
    Cu.reportError( "timestamp = " + s );
    return s.substr( 0, 10 ) + "_" + s.substr( 11, 2 ) + "=" + s.substr( 14,2 ) + "=" + s.substr( 17,2 );
}

