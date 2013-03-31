/*
 * We avoid using a "let" statement so that we can test this module with js-test-driver, which doesn't support
 * non-standard JavaScript syntax.
 */
var x = require( "action_platform" );
var Action_Platform = x.Action_Platform;

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


//-----------------------------------------------------------------------------------------
// Join Messaging
//-----------------------------------------------------------------------------------------
/*
 * Join messages are part of the basic action implementation, because the behavior of a join requires augmenting the
 * behavior of the finisher. Upon an action completing, it notifies other actions (directly or indirectly) that it has
 * completed. Thus, in addition to the caller-designated finisher functions, there may be an additional set of calls
 * made at this time.
 *
 * Some classes generate join messages, such as those that
 * wait for another action to complete. Some accept join messages, just as Join_class itself. Yet others, however, the
 * category of condition transformers, both generate and accept such messages, just as the gate for join-with-timeout.
 * As a consequence, we need to define these interfaces separately, so that, for example, both join actions and
 * condition transformers can each consistently accept messages
 */

/**
 * Interface for a receiver of join messages.
 * @interface
 */
Action.JM_Attentive = function()
{
};

/**
 * Receive a notice that a dependent condition has completed well.
 *
 * @param id
 */
Action.JM_Attentive.prototype.notice_good = function( id )
{
};

/**
 * Receive a notice that a dependent condition has completed badly.
 *
 * @param {*} id
 *    The identifier for the dependent condition in case there's more than one.
 * @param {*} e
 *    An exception object as it appears in a catch clause.
 */
Action.JM_Attentive.prototype.notice_bad = function( id, e )
{
};

/**
 * Interface for a sender of join messages. This interface is required because reporters have state that may need to be
 * queried by a receiver.
 * @interface
 */
Action.JM_Reporting = function()
{
};

/**
 * Watch the ending of this action.
 *
 * @param {Action.JM_Attentive} watcher
 *    The watcher object.
 * @param {*} their_id
 *    An opaque identifier by which the peer identifies the relation.
 * @returns {*}
 *    Our identifier for the relation.
 */
Action.JM_Reporting.prototype.watch = function( watcher, their_id )
{
};

//-------------------------------------------------------
/**
 * Base class implementation
 * @constructor
 * @implements {Action.JM_Reporting}
 * @implements {Action.Asynchronous_Action_interface}
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

Object.defineProperty( Action.Asynchronous_Action.prototype, "state", {
  get: function()
  {
    return this._state;
  }
} );

Object.defineProperty( Action.Asynchronous_Action.prototype, "completed", {
  get: function()
  {
    return this._state >= Action.State.Done;
  }
} );

Object.defineProperty( Action.Asynchronous_Action.prototype, "completed_well", {
  get: function()
  {
    return this._state == Action.State.Done;
  }
} );

Object.defineProperty( Action.Asynchronous_Action.prototype, "exception", {
  get: function()
  {
    if ( this._state == Action.State.Exception )
    {
      return this._exception;
    }
    else
    {
      throw new Error( "Action is not in an exception state." );
    }
  }
} );

/**
 * Start up the subprogram body for this action instance.
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
 * The default action body is to do nothing.
 */
Action.Asynchronous_Action.prototype._go = function()
{
};

/**
 * Cancellation is an ordinary end to an action. We halt execution of the action and end immediately.
 *
 * The analog of this method for exceptional end is abort().
 *
 * Design Note: Commands the force early end to an action only affect the action itself, at most. They do not affect
 * the execution of finisher and catcher functions that the action may have been invoked with. Nor do they affect
 * notices to join actions waiting on the early-terminated action. One of the motivations for this behavior is that we
 * want reliable actions to remain reliable. If cancellation were to cause finishers, not to run, no action could be
 * considered reliable.
 */
Action.Asynchronous_Action.prototype.cancel = function()
{
  this.end_well();
};

/**
 * Abortion in an exceptional end to an action. We halt execution of the action and end immediately.
 *
 * The analog of this method for ordinary end is cancel(), which see for more commentary.
 *
 * @param {*} [e]
 *    An exception object to associate with exceptional termination. If absent, defaults to a new Error object.
 */
Action.Asynchronous_Action.prototype.abort = function( e )
{
  this.end_badly( e ? e : new Error( "Action aborted by external command." ) );
};

/**
 * The default termination behavior is to do nothing.
 *
 * Actions that allocate resources should override this method and release their resources here. This method is always
 * called when the action ends.
 *
 * @protected
 */
Action.Asynchronous_Action.prototype.terminate = function()
{
};

/**
 * Change state to Done and execute the finisher.
 *
 * @protected
 */
Action.Asynchronous_Action.prototype.end_well = function()
{
  function good()
  {
    this.watcher.notice_good( this.id );
  }

  /*
   * We may only complete once.
   */
  if ( this.completed )
    return;
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
  this.terminate();
  this._each_watcher( good );
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
  function bad()
  {
    this.watcher.notice_bad( this.id, e );
  }

  /*
   * We may only complete once.
   */
  if ( this.completed )
    return;
  /*
   * In contrast to end_well(), this function does require a try-finally statement. If the catcher throws an
   * exception, then we still have to execute the finisher anyway.
   */
  try
  {
    this._state = Action.State.Exception;
    /**
     * The object identified with the exceptional completion of the action.
     *
     * @type {*}
     * @private
     */
    this._exception = e;
    this.terminate();
    this._each_watcher( bad );
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
 * @param {function} f
 *    A function to be called on the watcher structure.
 * @private
 */
Action.Asynchronous_Action.prototype._each_watcher = function( f )
{
  for ( var j = 0 ; j < this._end_watchers.length ; ++j )
  {
    try
    {
      /**
       * @type {{watcher:Action.JM_Attentive, id}}
       */
      var w = this._end_watchers[ j ];
      if ( !w )
      {
        /*
         * It's OK for a watcher to be null. All this means is that the watcher withdrew before completion.
         */
        continue;
      }
      f.call( w );
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
 * @param {Action.JM_Attentive} watcher
 *    The watcher object.
 * @param {*} their_id
 *    An opaque identifier by which the peer identifies itself.
 * @returns {number}
 *    Our identifier, which is the index in the _end_watchers array.
 */
Action.Asynchronous_Action.prototype.watch = function( watcher, their_id )
{
  return this._end_watchers.push( { watcher: watcher, id: their_id } ) - 1;
};

//noinspection JSUnusedGlobalSymbols
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
 * @extends Action.Asynchronous_Action
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
 * @extends Action.Asynchronous_Action
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
  if ( this.completed )
    return;
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

Action.Delay_class.prototype.terminate = function()
{
  Action_Platform.clear_timer( this.timer_id );
};

Action.Delay = function( f, duration )
{
  Action.Delay_class.init.call( this, f, duration );
};
Action.Delay.prototype = new Action.Delay_class();

//-------------------------------------------------------
// Join_class
//-------------------------------------------------------
/**
 * Class constructor for objects that join on a single action, perhaps with modifications.
 *
 * The policy for this class is that completion of the joined action causes completion of this action. This is a simple
 * join policy. Joining on more than action requires a more complicated action. This policy, however, is suitable not
 * only for Join itself, but also for Join_Timeout. Join_Timeout also depends only upon a single action; its timer is
 * internal and doesn't incur the overhead of an action for that simple case.
 *
 * @constructor
 * @extends {Action.Asynchronous_Action}
 */
Action.Join_class = function()
{
};
Action.Join_class.prototype = new Action.Asynchronous_Action();

/**
 * Initialization function for instance constructors.
 *
 * @this {Action.Join_class}
 * @param action
 */
Action.Join_class.init = function( action )
{
  if ( !action )
    throw new Error( "Action to be joined may not be null" );
  Action.Asynchronous_Action.init.call( this );
  this.joined_action = action;
};

/**
 * The action body for a join is to do nothing when the joined action is not yet completed.
 * @private
 */
Action.Join_class.prototype._go = function()
{
  if ( this.joined_action.completed )
  {
    if ( this.joined_action.completed_well )
    {
      this.end_well();
    }
    else
    {
      this.end_badly( this.joined_action.exception );
    }
  }
  else
  {
    this.joined_action.watch( this, null );
  }
};

/**
 * A good completion of the joined action yields a good completion for us.
 */
Action.Join_class.prototype.notice_good = function()
{
  this.end_well();
};

/**
 * A bad completion of the joined action yields a bad completion for us.
 */
Action.Join_class.prototype.notice_bad = function( id, e )
{
  this.end_badly( e );
};

//-------------------------------------------------------
// Join
//-------------------------------------------------------
/**
 * Join with another action. The completion of the action joined allows the join action to complete.
 *
 * @constructor
 * @param {Action.Asynchronous_Action} action
 */
Action.Join = function( action )
{
  Action.Join_class.init.call( this, action );
};
Action.Join.prototype = new Action.Join_class();

//-------------------------------------------------------
// Join_Timeout
//-------------------------------------------------------
/**
 * Join with another action and set a timer that may preemptively complete.
 *
 * @constructor
 * @param {Action.Asynchronous_Action} action
 * @param duration
 */
Action.Join_Timeout = function( action, duration )
{
  Action.Join_class.init.call( this, action );

  /**
   * The identifier of the platform timer. It's used for early termination of the timer, if needed.
   * @type {*}
   */
  this._timer_id = Action_Platform.set_timer( this.ding.bind( this ), duration );

  /**
   * Flag indicating that the action has timed out.
   * @type {boolean}
   * @private
   */
  this._timed_out = false;
};
Action.Join_Timeout.prototype = new Action.Join_class();

/**
 * Flag indicating that the action has timed out. This is a read-only version of a private property, but with the
 * caveat that calling it is only valid in a completed state.
 *
 * @this {Action.Join_Timeout}
 * @return {boolean}
 */
Object.defineProperty( Action.Join_Timeout.prototype, "timed_out", {
  get: function()
  {
    if ( this.completed )
    {
      return this._timed_out;
    }
    else
    {
      throw new Error( "Action is not yet completed." );
    }
  }
} );

/**
 * The timer just went off.
 */
Action.Join_Timeout.prototype.ding = function()
{
  this._timer_id = null;
  /*
   * If we've already completed, we don't change the completion state.
   */
  if ( this.completed )
    return;
  /*
   * Since we haven't completed at this point, the timer has gone off before the action completed. Timeout is
   * considered an exceptional completion.
   */
  this._timed_out = true;
  this.end_badly( new Error( "Action timed out." ) );
};

/**
 * Termination requires clearing any timer that may still be active.
 *
 * @override
 */
Action.Join_Timeout.prototype.terminate = function()
{
  if ( this._timer_id )
    Action_Platform.clear_timer( this._timer_id );
};

//-------------------------------------------------------
// Join Conditions
//-------------------------------------------------------
/**
 *
 * @interface
 * @extends Action.JM_Attentive
 */
Action.Join_Condition = function()
{
};

//-------------------------------------------------------
/**
 *
 * @param duration
 * @constructor
 */
Action.JC_Gate_Timeout = function( duration )
{
  this.bound_ding = this.ding.bind( this );
  this.timer = Action_Platform.set_timer( this.bound_ding, duration );
};

/**
 * The timer just went off.
 */
Action.JC_Gate_Timeout.prototype.ding = function()
{
};

/**
 * Cancel the timer before it goes off.
 */
Action.JC_Gate_Timeout.prototype.cancel = function()
{
  Action_Platform.clear_timer( this.bound_ding );
};

//-------------------------------------------------------
/**
 * @constructor
 * @implements {Action.Join_Condition}
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

Action.Join_Conjunction.prototype.notice_good = function()
{
};

Action.Join_Conjunction.prototype.notice_bad = function()
{
};

