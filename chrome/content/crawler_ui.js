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
let { Storage } = require( "storage" );
let { Logger } = require( "logger" );
let { Application_Session } = require( "application" );

//-------------------------------------------------------
// Globals and Handlers
//-------------------------------------------------------

var crawler_ui_log = (new Logger( "crawler_ui" )).make_log();

var current_session = null;
var preference_service, preference_branch;
var go_button;
var base_name, base_name_initial_value;
var number_of_tabs;
var input_file, input_file_initial_value;
var output_directory, output_directory_initial_value;
var log_window, progress_message;

function loader()
{
  crawler_ui_log( "Loading." );

  log_window = new Crawl_Display();
  progress_message = document.getElementById( "progress" );
  go_button = document.getElementById( "crawl_go" );
  preference_service = Cc["@mozilla.org/preferences-service;1"].getService( Ci.nsIPrefService );
  preference_branch = preference_service.getBranch( "extensions.abpcrawler." );

  /*
   * Set up the output directory values and preferences.
   */
  input_file = document.getElementById( "input_file" );
  base_name = document.getElementById( "base_name" );
  output_directory = document.getElementById( "output_directory" );

  if ( preference_branch.prefHasUserValue( "input_file" ) )
  {
    input_file_initial_value = preference_branch.getCharPref( "input_file" );
    input_file.value = input_file_initial_value;
  }
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

  document.getElementById( "input_file_icon" ).addEventListener( "click", icon_input_click );
  document.getElementById( "output_directory_icon" ).addEventListener( "click", icon_output_click );
}

function unloader()
{
  crawler_ui_log( "Unloading." );
  if ( current_session )
  {
    current_session.close();
    current_session = null;
  }
}

function icon_input_click()
{
  var fp = Cc["@mozilla.org/filepicker;1"].createInstance( Ci.nsIFilePicker );
  fp.init( window, "Select an Input File", Ci.nsIFilePicker.modeOpen );
  if ( input_file.value != "" && input_file.value != null )
  {
    var f = new FileUtils.File( input_file.value );
    if ( f.exists() )
    {
      if ( f.isFile() )
      {
        f = f.parent;
      }
      if ( f.isDirectory() )
      {
        fp.displayDirectory = f;
      }
    }
  }
  var result = fp.show();
  switch ( result )
  {
    case Ci.nsIFilePicker.returnOK:
      f = fp.file;
      if ( f.isFile() )
      {
        input_file.value = fp.file.path;
      }
      break;
    case Ci.nsIFilePicker.returnCancel:
      break;
    case Ci.nsIFilePicker.returnReplace:
      break;
    default:
      break;
  }
}

function icon_output_click()
{
  var fp = Cc["@mozilla.org/filepicker;1"].createInstance( Ci.nsIFilePicker );
  fp.init( window, "Select an Output Folder", Ci.nsIFilePicker.modeGetFolder );
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

//-------------------------------------------------------
// Start Crawl
//-------------------------------------------------------
function start_crawl()
{
  crawler_ui_log( "Start" );

  /*
   * Save preferences automatically when we start a crawl.
   */
  var saving_input = ( input_file_initial_value != input_file.value );
  var saving_basename = ( base_name_initial_value != base_name.value );
  var saving_dir = ( output_directory.value != output_directory_initial_value );
  if ( saving_input )
  {
    preference_branch.setCharPref( "input_file", input_file.value );
  }
  if ( saving_basename )
  {
    preference_branch.setCharPref( "base_name", base_name.value );
  }
  if ( saving_dir )
  {
    preference_branch.setCharPref( "output_directory", output_directory.value );
  }
  if ( saving_input || saving_basename || saving_dir )
  {
    preference_service.savePrefFile( null );
    /*
     * Recalculate initial values only when saving.
     */
    input_file_initial_value = input_file.value;
    base_name_initial_value = base_name.value;
    output_directory_initial_value = output_directory.value;
  }
  var log_to_textbox = new Storage.Display_Log( log_window );

  /*
   * Encoding
   */
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

  /*
   * Window
   */
  let mainWindow = window.opener;
  if ( !mainWindow || mainWindow.closed )
  {
    log_window.log( "Unable to find the main window, aborting." );
    return false;
  }

  /*
   * Miscellaneous
   */
  // Initialize fixed part of the progress message
  document.getElementById( "progress_label" ).value = "Active/Completed/Total";

  /*
   * Session. Note that we create the session object before the outputs, since the session class has multiple ways
   * of specifying them.
   */
  current_session = new Application_Session(
    mainWindow,
    document.getElementById( "leave_open" ).checked,
    document.getElementById( "number_of_tabs" ).value,
    function( x )
    {
      progress_message.value = x.active + "/" + x.completed + "/" + x.total;
    }
  );

  /*
   * Input
   */
  switch ( document.getElementById( "instructions_tabbox" ).selectedIndex )
  {
    case 0:
      log_window.log( "Server input not supported at present. Aborted." );
      return false;
    case 1:
      try
      {
        current_session.set_input_file( input_file.value );
      }
      catch ( e )
      {
        log_window.log( e.message );
        return false;
      }
      break;
    case 2:
      var fixed_source = ""
        + "name: Fixed internal development test\n"
        + "target:\n"
        + "    - yahoo.com\n"
        + "    - ksl.com\n"
        + "";
      try
      {
        current_session.set_input_string( fixed_source );
      }
      catch ( e )
      {
        log_window.log( e.message );
        return false;
      }
      break;
    default:
      log_window.log( "WTF? Unknown input tab. Aborted." );
      return false;
  }

  /*
   * Output
   */
  current_session.add_output( log_to_textbox, "YAML" );
  switch ( document.getElementById( "storage_tabbox" ).selectedIndex )
  {
    case 0:
      log_window.log( "Server storage not supported at present. Aborted." );
      return false;
    case 1:
      try
      {
        var output_file_name =
          current_session.add_output_file( output_directory.value, base_name.value, true, encoding );
      }
      catch ( e )
      {
        log_window.log( e.message );
        return false;
      }
      log_window.log( "Computed file name = " + output_file_name );
      break;
    case 2:
      break;
    default:
      log_window.log( "WTF? Unknown storage tab. Aborted." );
      return false;
  }

  current_session.run( crawl_finally, crawl_catch );

  // This function is an event handler.
  return true;
}

function crawl_catch( ex )
{
  Cu.reportError( "crawler_ui: Caught crawl exception=" + ex.toString() );
}

function crawl_finally()
{
  crawler_ui_log( "Finish" );
  log_window.log( "Finish" );
  current_session = null;
}

//-------------------------------------------------------
// Crawl_Display
//-------------------------------------------------------
/**
 * Constructor for a display object for the crawler.
 */
function Crawl_Display()
{
  this.display_log = document.getElementById( "display_log" );
  this.log_box = document.getElementById( "log_box" );
}

Crawl_Display.prototype.log = function( message )
{
  this.log_box.value += message + "\n";
};

Crawl_Display.prototype.write = function( message )
{
  if ( this.display_log.checked )
    this.log_box.value += message;
};
