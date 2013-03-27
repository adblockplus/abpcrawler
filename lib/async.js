/**
 * The namespace for this asynchrony library.
 *
 * @namespace
 * @const
 * @type {*}
 */
Async = {};

//-------------------------------------------------------
/**
 * @namespace
 */
Async.Action = {};

/**
 * The common states of all actions. The ordinary start state is Ready leads to only three transitions: from Ready to
 * Running, and from Running to both Done and Exception. For actions that are not fully initialized by their constructors,
 * there's also the state Init and a transition to Ready.
 * @enum {number}
 */
Async.Action.State = {
  /**
   * An available start state for actions that use more then their constructors for initialization.
   */
  Init: 0,
  /**
   * The ordinary start state. An action is ready after it is fully initialized.
   */
  Ready: 1,
  /**
   * The subprogram of the action is currently running. The state is changed immediately upon the call to go() or run().
   */
  Running: 2,
  /**
   * The action completed without exception. In this case no catch function was called. The state is changed after the
   * subprogram has finished and before calling the finally function.
   */
  Done: 3,
  /**
   * The action threw an exception. In this case any catch function specified would be called. The state is changed
   * after the subprogram has finished and before calling the catch function.
   */
  Exception: 4
};

/**
 * The base action interface is just a marker.
 * @interface
 */
Async.Action_interface = function()
{
  /**
   * Every action is either reliable, which means that it's guaranteed to return control to the caller, or unreliable,
   * which means no such guarantee exists. Unreliable does not mean "never returns"; what would be the point of that?
   *
   * Reliability is a self-declaration for primitive actions. For composite actions, that is, actions that have at least
   * one other action within themselves, reliability can (often) be inferred.
   *
   * @expose
   * @type {boolean}
   */
  this.reliable = null;
};

/**
 *
 * @interface
 * @extends Async.Action_interface
 */
Async.Synchronous_Action_interface = function()
{
  /**
   * Every synchronous action is, by definition, reliable, since it always returns control to its caller. The return
   * of control can be either ordinary or exceptional, but that distinction is irrelevant to the meaning of "reliable".

   * @type {boolean}
   */
  this.reliable = true;
};

/**
 * The subprogram of a synchronous action is called 'run', to distinguish it from an asynchronous subprogram.
 */
Async.Synchronous_Action_interface.prototype.run = function()
{
};

//-------------------------------------------------------
/**
 * @interface
 * @extends Async.Action_interface
 */
Async.Asynchronous_Action_interface = function()
{
  /**
   * The default for an asynchronous action is unreliable. While some asynchronous actions are reliable, its prudent not
   * to assume that otherwise without specific knowledge.
   *
   * @type {boolean}
   */
  this.reliable = false;
};

Async.Asynchronous_Action_interface.prototype._go = function()
{
};


//-------------------------------------------------------
/**
 * @constructor
 */
Async.Asynchronous_Action = function()
{
};

/**
 * @this {Async.Asynchronous_Action}
 */
Async.Asynchronous_Action.init = function()
{
  /**
   * The common state of a asynchronous action
   * @type {Async.Action.State}
   * @private
   */
  this._state = Async.Action.State.Ready;
};

/**
 *
 * @param {function} [finally_f]
 * @param {function} [catch_f]
 */
Async.Asynchronous_Action.prototype.go = function( finally_f, catch_f )
{
  if ( this._state != Async.Action.State.Ready )
  {
    throw new Error( "Call to go() is invalid because the action is not in state 'Ready'." );
  }
  this.finally_f = finally_f;
  this.catch_f = catch_f;
  this._state = Async.Action.State.Running;
  this._go();
};

/**
 * Change state to Done and execute the finally function.
 *
 * @protected
 */
Async.Asynchronous_Action.prototype.end_well = function()
{
  /*
   * Note that there's no exception handling in this function. In order to mimic the behavior of the try-finally
   * statement, an exception thrown from a finally function is treated as if it had happened within a finally block,
   * which is to say, it throws the exception. There's no need for extra code to do that.
   *
   * In addition, the state is left at Done if the finally function throws an exception. In this case, the exception
   * does not come from the action itself, but from user code. So regardless of how the finally function terminates, it
   * does not change that the action completed ordinarily.
   */
  this._state = Async.Action.State.Done;
  if ( this.finally_f ) this.finally_f();
};

/**
 * Change state to Exception and execute the catch function followed by the finally function.
 *
 * @protected
 * @param e
 *    An exception value
 */
Async.Asynchronous_Action.prototype.end_badly = function( e )
{
  /*
   * In contrast to end_well(), this function does require a try-finally statement. If the catch function throws an
   * exception, then we still have to execute the finally function anyway.
   */
  try
  {
    this._state = Async.Action.State.Exception;
    if ( this.catch_f ) this.catch_f( e );
  }
  finally
  {
    if ( this.finally_f ) this.finally_f();
  }
};

//-------------------------------------------------------
/**
 * @interface
 * @extends Async.Action_interface
 */
Async.Joinable = function()
{
};

//-----------------------------------------------------------------------------------------
// UTILITY
//-----------------------------------------------------------------------------------------
Async.dispatch = Async_Platform.dispatch;

//-----------------------------------------------------------------------------------------
// ACTIONS
//-----------------------------------------------------------------------------------------

//-------------------------------------------------------
// Defer
//-------------------------------------------------------
/**
 * Class constructor for Defer actions, which defer execution of a function (the "trial") until after the current
 * JavaScript-thread has run to completion.
 *
 * @constructor
 * @implements Async.Asynchronous_Action_interface
 */
Async.Defer_class = function()
{
  /**
   * @const
   * @type {boolean}
   */
  this.reliable = true;
};
Async.Defer_class.prototype = new Async.Asynchronous_Action();

/**
 *
 */
Async.Defer_class.prototype._go = function()
{
  Async_Platform.dispatch( this._body.bind( this ) );
};

/**
 * The deferred trial is run inside of a try-catch-finally statement.
 * @private
 */
Async.Defer_class.prototype._body = function()
{
  try
  {
    if ( this.try_f ) this.try_f();
  }
  catch ( e )
  {
    this.end_badly( e );
    return;
  }
  this.end_well();
};

/**
 * Instance constructor for standard Defer actions.
 * @param f
 * @constructor
 */
Async.Defer = function( f )
{
  Async.Asynchronous_Action.init.call( this );
  this.try_f = f;
};
Async.Defer.prototype = new Async.Defer_class();

//-------------------------------------------------------
/**
 *
 * @constructor
 * @implements Async.Asynchronous_Action_interface
 */
Async.Delay_class = function()
{
  /**
   * Delay actions always complete, even if cancelled or aborted early.
   * @const
   * @type {boolean}
   */
  this.reliable = true;
};
Async.Delay_class.prototype = new Async.Asynchronous_Action();

/**
 * Initialization function for use by instance constructors.
 * @param f
 * @param duration
 */
Async.Delay_class.init = function( f, duration )
{
  Async.Asynchronous_Action.init.call( this );
  this.try_f = f;
  this.duration = duration;
};

Async.Delay_class.prototype._go = function()
{
  this.timer_id = Async_Platform.set_timer( this._body.bind( this ), this.duration );
};

Async.Delay_class.prototype._body = function()
{
  try
  {
    if ( this.try_f ) this.try_f();
  }
  catch ( e )
  {
    this.end_badly( e );
    return;
  }
  this.end_well();
};

/**
 * Terminate this timer without prejudice. The finally function will run as always.
 */
Async.Delay_class.prototype.cancel = function()
{
};

/**
 * Terminate a c
 */
Async.Delay_class.prototype.abort = function()
{
};


Async.Delay = function( f, duration )
{
  Async.Delay_class.init.call( this, f, duration );
};
Async.Delay.prototype = new Async.Delay_class();

//-------------------------------------------------------
/**
 *
 * @constructor
 */
Async.Join_class = function()
{
};

//-------------------------------------------------------
/**
 *
 * @interface
 */
Async.Join_Condition = function()
{
};

//-------------------------------------------------------
/**
 *
 * @implements Async.Join_Condition
 * @constructor
 * @param {Array.Joinable} actions
 */
Async.Join_Conjunction = function( actions )
{
};
