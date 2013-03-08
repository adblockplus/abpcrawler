/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

Cu.import( "resource://gre/modules/FileUtils.jsm" );

let {Storage} = require( "storage" );
let {Instruction, Instruction_Set, Input_String, Input_File} = require( "instruction" );
let {Long_Task} = require( "task" );
let {Crawler} = require( "crawler" );
let {Logger} = require( "logger" );

/*
 * The purpose of this module is to isolate the parameters needed to run a crawl from the means by which those
 * parameters are collected by top-level interface code. There are two basic forms of interface: interactive and
 * automated. The interactive interface uses a XUL dialog and starts a crawl when the user presses a button. The
 * automated interface handles command line options and starts a crawl when the command line arrives.
 *
 * There are two kinds of arguments to the Application_Session constructor. The first kind are internal resources needed
 * to perform the crawl. Notable here is the 'window' argument, which designates where to open the tabs for each crawled
 * site. This comes easy in the interactive version, but a window must be created for the automated one. The second kind
 * of argument are the external parameters that the user manipulates, such as the specification for the instructions.
 *
 * Internal.
 *  - window. The window in which to run the tabs.
 *  - progress. A progress monitor. Only useful for interactive modes.
 *  - output (transient). If required, output to a log window in YAML format.
 * External.
 *  - instructions. Contains a list of all the sites to crawl. There are multiple ways of obtaining this set, all of
 *  which start with a text stream which is then parsed and converted to an {Instruction_Set} object. Mandatory.
 *      - Local input file. Parameter is a local file name. By convention local files are in YAML format.
 *      - Text string. Parameter is the text itself plus the name of one of the formats.
 *          - YAML format. Used for an interactive, multiline textbox. (Not implemented)
 *          - JSON format. Used for accepting instructions from the command line. (Not implemented)
 *  - output (persistent). The recorded results of the crawl.
 *      - local file name. Optional for interactive use, since a log window might be adequate. Mandatory for automated
 *      use, otherwise what's the point?
 *     - format. Either YAML or JSON. Default to JSON.
 *  - leave_open. Leave the tabs open after crawling them. Only useful for interaction, say, in order to examine the DOM
 *  after a trial. Always false for automated use. Default is false for interactive use.
 *  - number_of_tabs. The number of simultaneous tabs. Built-in default if not present.
 */

/**
 * @param {Window} window
 * @param {boolean} leave_open
 * @param {number} n_tabs
 * @param {Function} progress
 * @constructor
 */
var Application_Session = function( window, leave_open, n_tabs, progress )
{
    this.runnable = true;
    this.instructions = [];
    this.outputs = [];
    this.window = window;
    this.leave_open = leave_open;
    this.n_tabs = n_tabs;
    this.progress = progress;
};
exports.Application_Session = Application_Session;

Application_Session.prototype.run = function( finally_f, catch_f )
{
    this.finally_f = finally_f;
    this.catch_f = catch_f;
    if ( !this.runnable )
    {
        this._run_catch( new Error( "Application_Session is not runnable" ) );
        return;
    }
    this.runnable = false;

    this.current_crawler = new Crawler(
        this.instructions, this.outputs, this.window,
        this.leave_open, this.n_tabs
    );

    if ( this.progress )
    {
        /*
         * Add an instance-specific notice member to the crawler's progress instance. This is cleaner than
         * bothering with a subclass of the progress-notification class.
         */
        this.current_crawler.progress.notice = function( notice )
        {
            notice( this );
        }.bind( this.current_crawler.progress, this.progress );
    }
    this.current_crawl = new Long_Task( this.current_crawler );
    this.current_crawl.run( this._run_finally.bind( this ), this._run_catch.bind( this ) );
};

/**
 *
 * @param {*} ex
 *      Value to treat as a thrown exception. Treated as an opaque type.
 * @private
 */
Application_Session.prototype._run_catch = function( ex )
{
    if ( this.catch_f ) this.catch_f( ex );
    this._run_finally();
};

Application_Session.prototype._run_finally = function()
{
    if ( this.finally_f ) this.finally_f();
};

/**
 * Close the application session.
 */
Application_Session.prototype.close = function()
{
    if ( this.current_crawl )
    {
        this.current_crawl.close();
        this.current_crawl = null;
    }
    if ( this.current_crawler )
    {
        this.current_crawler.close();
        this.current_crawler = null;
    }
};

/**
 * Set an input string to specify the instruction set.
 *
 * @param {string} s
 */
Application_Session.prototype.set_input_string = function( s )
{
    this.instructions = new Instruction_Set.Parsed( new Input_String( s ) );
};

/**
 * Set an input file from which to read the instruction set.
 *
 * @param {string} file_path
 */
Application_Session.prototype.set_input_file = function( file_path )
{
    var f = new FileUtils.File( file_path );
    if ( !f.exists() )
    {
        throw new Error( "Input file does not exist. path = " + f.path );
    }
    if ( !f.isFile() )
    {
        throw new Error( "Input file path does not name a file. path = " + f.path );
    }
    if ( !f.isReadable() )
    {
        throw new Error( "Input file is not readable. path = " + f.path );
    }
    this.instructions = new Instruction_Set.Parsed( new Input_File( f ) );
};

/**
 * Add a storage-encoding pair to the output list for the current session.
 *
 * @param storage
 * @param {String} encode
 *      Either "JSON" or "YAML".
 */
Application_Session.prototype.add_output = function( storage, encode )
{
    this.outputs.push( { storage: storage, encode: encode } );
};

/**
 * Add a file to the output list. Throws if it detects obvious problems with the arguments specifying a valid output,
 * namely, if the directory path is not a writable directory or if the encoding is invalid.
 *
 * @param {string} directory_path
 *      Directory path for the output file.
 * @param {string} base_name
 *      Base name for the output file.
 * @param {boolean} append_timestamp
 *      Whether to append a timestamp to the base name, or not.
 * @param {string} encode
 *      Either "JSON" or "YAML".
 * @return {string}
 *      The constructed file name.
 */
Application_Session.prototype.add_output_file = function( directory_path, base_name, append_timestamp, encode )
{
    var file = Cc["@mozilla.org/file/local;1"].createInstance( Ci.nsILocalFile );
    file.initWithPath( directory_path );
    if ( !file.exists() )
    {
        throw new Error( "Output directory path does not exist. path = " + directory_path );
    }
    if ( !file.isDirectory() )
    {
        throw new Error( "Output directory path does not name a directory. path = " + directory_path );
    }
    if ( !file.isWritable() )
    {
        throw new Error( "Output directory is not writable. path = " + directory_path );
    }
    var file_name = ( base_name && base_name.length > 0 ) ? base_name : "crawl-results";
    if ( append_timestamp )
    {
        file_name += filename_timestamp();
    }
    switch ( encode )
    {
        case "JSON":
            file_name += ".json";
            break;
        case "YAML":
            file_name += ".yaml";
            break;
        default:
            throw new Error( "Invalid encoding = " + encode + ". Must be JSON or YAML." );
    }
    file.append( file_name );
    this.add_output( new Storage.Local_File( file ), encode );
    return file.path;
};

function filename_timestamp()
{
    var s = Logger.timestamp();
    return "_" + s.substr( 0, 10 ) + "_" + s.substr( 11, 2 ) + "-" + s.substr( 14, 2 ) + "-" + s.substr( 17, 2 );
}
