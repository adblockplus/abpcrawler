/**
 * @fileOverview A platform-specific primitive set for the module action.js. This version is for Firefox extensions.
 */

/**
 * @namespace
 */
Action_Platform = {};

/**
 * An instance of the NS thread manager.
 * @type {nsIThreadManager}
 */
Action_Platform.thread_manager = Cc["@mozilla.org/thread-manager;1"].createInstance( Ci.nsIThreadManager );

/**
 * Dispatch a function into the next JavaScript thread.
 * @param {function} f
 */
Action_Platform.dispatch = function( f )
{
  Action_Platform.thread_manager.currentThread.dispatch(
    {run: f},
    Ci.nsIEventTarget.DISPATCH_NORMAL
  );
};

/**
 * Timer class for the NS timer.
 * @constructor
 */
Action_Platform.Timer = function()
{
  /**
   * An instance of the NS timer, which
   * @type {*}
   */
  this.timer = Cc["@mozilla.org/timer;1"].createInstance( Ci.nsITimer )
};

/**
 * @param {function} f
 * @param {number} duration
 */
Action_Platform.Timer.prototype.set = function( f, duration )
{
  this.timer.initWithCallback( f, duration, Ci.nsITimer.TYPE_ONE_SHOT )
};

Action_Platform.Timer.prototype.clear = function()
{
  this.timer.cancel();
};

/**
 * Set the timer.
 * @param {function} f
 * @param {number} duration
 * @return {Action_Platform.Timer}
 */
Action_Platform.set_timer = function( f, duration )
{
  var t = new Action_Platform.Timer();
  t.set( f, duration );
  return t;
};

/**
 * Clear the timer.
 * @param {Action_Platform.Timer} id
 */
Action_Platform.clear_timer = function( id )
{
  id.clear();
};

exports.Action_Platform = Action_Platform;