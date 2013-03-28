/**
 * @namespace The action library, working with both synchronous and asynchronous actions.
 */
Action = {};

/**
 * The common states of all actions. The ordinary start state is Ready leads to only three transitions: from Ready to
 * Running, and from Running to both Done and Exception. For actions that are not fully initialized by their constructors,
 * there's also the state Init and a transition to Ready.
 * @enum {number}
 */
Action.State = {
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
   * The action completed without exception. In this case no catcher was called. The state is changed after the
   * subprogram has finished and before calling the finisher.
   */
  Done: 3,
  /**
   * The action threw an exception. In this case any catcher specified would be called. The state is changed
   * after the subprogram has finished and before calling the catcher.
   */
  Exception: 4
};

/**
 * The base action interface is just a marker.
 * @interface
 */
Action.Action_interface = function()
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
 * @extends Action.Action_interface
 */
Action.Synchronous_Action_interface = function()
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
Action.Synchronous_Action_interface.prototype.run = function()
{
};

//-------------------------------------------------------
/**
 * @interface
 * @extends Action.Action_interface
 */
Action.Asynchronous_Action_interface = function()
{
  /**
   * The default for an asynchronous action is unreliable. While some asynchronous actions are reliable, its prudent not
   * to assume that otherwise without specific knowledge.
   *
   * @type {boolean}
   */
  this.reliable = false;
};

Action.Asynchronous_Action_interface.prototype._go = function()
{
};


//-------------------------------------------------------
/**
 * @interface
 */
Action.Watcher_interface = function()
{
};
Action.Watcher_interface.prototype.good = function( id )
{
};
Action.Watcher_interface.prototype.bad = function( id )
{
};

//-------------------------------------------------------
/**
 * @constructor
 */
Action.Asynchronous_Action = function()
{
};

/**
 * @this {Action.Asynchronous_Action}
 */
Action.Asynchronous_Action.init = function()
{
  /**
   * The common state of a asynchronous action
   * @type {Action.State}
   * @private
   */
  this._state = Action.State.Ready;

  /**
   * @type {Array.<{watcher,id}>}
   */
  this._end_watchers = [];
};

/**
 *
 * @param {function} [finisher]
 * @param {function} [catcher]
 */
Action.Asynchronous_Action.prototype.go = function( finisher, catcher )
{
  if ( this._state != Action.State.Ready )
  {
    throw new Error( "Call to go() is invalid because the action is not in state 'Ready'." );
  }
  this.finisher = finisher;
  this.catcher = catcher;
  this._state = Action.State.Running;
  this._go();
};

/**
 * Change state to Done and execute the finisher.
 *
 * @protected
 */
Action.Asynchronous_Action.prototype.end_well = function()
{
  /*
   * Note that there's no exception handling in this function. In order to mimic the behavior of the try-finally
   * statement, an exception thrown from a finisher is treated as if it had happened within a finally block, which is to
   * say, it throws the exception. There's no need for extra code to do that.
   *
   * In addition, the state is left at Done if the finisher throws an exception. In this case, the exception does not
   * come from the action itself, but from user code. So regardless of how the finisher terminates, it does not change
   * that the action completed ordinarily.
   */
  this._state = Action.State.Done;
  this._each_watcher( "good" );
  if ( this.finisher ) this.finisher();
};

/**
 * Change state to Exception and execute the catcher followed by the finisher.
 *
 * @protected
 * @param e
 *    An exception value
 */
Action.Asynchronous_Action.prototype.end_badly = function( e )
{
  /*
   * In contrast to end_well(), this function does require a try-finally statement. If the catcher throws an
   * exception, then we still have to execute the finisher anyway.
   */
  try
  {
    this._state = Action.State.Exception;
    this._each_watcher( "bad" );
    if ( this.catcher ) this.catcher( e );
  }
  finally
  {
    if ( this.finisher ) this.finisher();
  }
};

/**
 * Call a function on each watcher.
 *
 * @param {string} fname
 *    The name of the function to be called. Methods in Action.Watcher_interface are permissible names.
 * @private
 */
Action.Asynchronous_Action.prototype._each_watcher = function( fname )
{
  for ( var j = 0 ; j < this._end_watchers.length ; ++j )
  {
    try
    {
      /**
       * @type {{watcher:Action.Watcher_interface, id}}
       */
      var w = this._end_watchers[ j ];
      if ( !w )
      {
        /*
         * It's OK for a watcher to be null. All this means is that the watcher withdrew before completion.
         */
        continue;
      }
      w.watcher[ fname ]( w.id );
    }
    catch ( e )
    {
      /*
       * The use of this catch block is a defense so that we can ignore exceptions. There shouldn't be any, though, but
       * just in case.
       */
    }
    /*
     * Remove references all the end watchers at once by deleting the watcher array. Since we only run an action at
     * most once, this causes no adverse affect.
     */
    delete this._end_watchers;
  }
};

/**
 * Watch the ending of this action.
 *
 * @param {Action.Watcher_interface} watcher
 *    The watcher object.
 * @param {*} their_id
 *    An opaque identifier by which the peer identifies itself.
 * @returns {number}
 *    Our identifier, which is the index of
 */
Action.Asynchronous_Action.prototype.watch = function( watcher, their_id )
{
  return this._end_watchers.push( { watcher: watcher, id: their_id } ) - 1;
};

/**
 * Withdraw a watcher
 */
Action.Asynchronous_Action.prototype.withdraw = function( our_id )
{
  this._end_watchers[ our_id ] = null;
};

//-------------------------------------------------------
/**
 * @interface
 * @extends Action.Action_interface
 */
Action.Joinable = function()
{
};

//-----------------------------------------------------------------------------------------
// UTILITY
//-----------------------------------------------------------------------------------------
Action.dispatch = Action_Platform.dispatch;

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
 * @implements Action.Asynchronous_Action_interface
 */
Action.Defer_class = function()
{
  /**
   * @const
   * @type {boolean}
   */
  this.reliable = true;
};
Action.Defer_class.prototype = new Action.Asynchronous_Action();

/**
 *
 */
Action.Defer_class.prototype._go = function()
{
  Action.dispatch( this._body.bind( this ) );
};

/**
 * The deferred trial is run inside of a try-catch-finally statement.
 * @private
 */
Action.Defer_class.prototype._body = function()
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
Action.Defer = function( f )
{
  Action.Asynchronous_Action.init.call( this );
  this.try_f = f;
};
Action.Defer.prototype = new Action.Defer_class();

//-------------------------------------------------------
/**
 *
 * @constructor
 * @implements Action.Asynchronous_Action_interface
 */
Action.Delay_class = function()
{
  /**
   * Delay actions always complete, even if cancelled or aborted early.
   * @const
   * @type {boolean}
   */
  this.reliable = true;
};
Action.Delay_class.prototype = new Action.Asynchronous_Action();

/**
 * Initialization function for use by instance constructors.
 * @param f
 * @param duration
 */
Action.Delay_class.init = function( f, duration )
{
  Action.Asynchronous_Action.init.call( this );
  this.try_f = f;
  this.duration = duration;
};

Action.Delay_class.prototype._go = function()
{
  this.timer_id = Action_Platform.set_timer( this._body.bind( this ), this.duration );
};

Action.Delay_class.prototype._body = function()
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

Action.Delay_class.prototype._terminate = function()
{
  Action_Platform.clear_timer( this.timer_id );
};

/**
 * Terminate this action without prejudice. The finisher will run as always.
 */
Action.Delay_class.prototype.cancel = function()
{
  this._terminate();
  this.end_well();
};

/**
 * Terminate this action with prejudice (but not extreme prejudice). The catcher and finisher will run.
 */
Action.Delay_class.prototype.abort = function( e )
{
  this._terminate();
  this.end_badly( e ? e : new Error( "Aborted forcibly." ) );
};


Action.Delay = function( f, duration )
{
  Action.Delay_class.init.call( this, f, duration );
};
Action.Delay.prototype = new Action.Delay_class();

//-------------------------------------------------------
/**
 *
 * @constructor
 */
Action.Join_class = function()
{
};
Action.Join_class.prototype = new Action.Asynchronous_Action();

Action.Join_class.init = function()
{
};


/**
 * Join with another action. This completion of the action joined allows the join action to complete.
 */
Action.Join = function()
{
};

//-------------------------------------------------------
/**
 *
 * @interface
 */
Action.Join_Condition = function()
{
};

//-------------------------------------------------------
/**
 * @implements Action.Join_Condition
 * @constructor
 * @param {Array.Joinable} actions
 */
Action.Join_Conjunction = function( actions )
{
  /**
   * The conjunction of actions is reliable only if all the actions are reliable.
   */
  this.reliable = true;
  for ( var j = 0 ; j < actions.length ; ++j )
  {
    if ( !actions[ j ].reliable )
    {
      this.reliable = false;
      break;
    }
  }
};
