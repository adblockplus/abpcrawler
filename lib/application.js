/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

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
 * @param {Instruction_Set} instructions
 *      The instruction set, typically parsed from an input specification file.
 * @param {*} log_window
 *      Interactive log window.
 * @param {Window} window
 * @param {boolean} leave_open
 * @param {number} n_tabs
 * @param {Function} progress
 * @constructor
 */
var Application_Session = function( instructions, log_window, window, leave_open, n_tabs, progress )
{
    this.runnable = true;
    this.instructions = instructions;
    this.outputs = [];
    this.log_window = log_window;
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
        this.instructions, this.outputs, this.log_window, this.window,
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

Application_Session.prototype.add_output = function( storage, encode )
{
    this.outputs.push( { storage: storage, encode: encode } );
};
