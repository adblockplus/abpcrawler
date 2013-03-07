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

/**
 * @constructor
 */
var Application_Session = function( instructions, outputs, log_window, window, leave_open, n_tabs, progress )
{
    this.runnable = true;
    this.instructions = instructions;
    this.outputs = outputs;
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

    var current_crawler = new Crawler(
        this.instructions, this.outputs, this.log_window, this.window,
        this.leave_open, this.n_tabs
    );

    if ( this.progress )
    {
        /*
         * Add an instance-specific notice member to the crawler's progress instance. This is cleaner than
         * bothering with a subclass of the progress-notification class.
         */
        current_crawler.progress.notice = function( notice )
        {
            notice( this );
        }.bind( current_crawler.progress, this.progress );
    }
    var current_crawl = new Long_Task( current_crawler );
    current_crawl.run( this._run_finally.bind( this ), this._run_catch.bind( this ) );
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

Application_Session.prototype.add_output = function()
{
};

