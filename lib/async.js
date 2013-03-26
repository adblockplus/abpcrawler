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

/**
 * @inheritDoc
 */
Async.Defer_class.prototype.go = function( finally_f, catch_f )
{
  this.finally_f = finally_f;
  this.catch_f = catch_f;
  Async_Platform.dispatch( this._go.bind( this ) );
};

/**
 * The deferred trial is run inside of a try-catch-finally statement.
 * @private
 */
Async.Defer_class.prototype._go = function()
{
  try
  {
    if ( this.try_f ) this.try_f();
  }
  catch ( e )
  {
    if ( this.catch_f ) this.catch_f( e );
  }
  finally
  {
    if ( this.finally_f ) this.finally_f();
  }
};

/**
 * Instance constructor for standard Defer actions.
 * @param f
 * @constructor
 */
Async.Dispatch = function( f )
{
  this.try_f = f;
};
Async.Dispatch.prototype = new Async.Defer_class();

//-------------------------------------------------------
/**
 *
 * @constructor
 */
Async.Timer_class = function()
{
};

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
