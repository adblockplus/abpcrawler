AsyncTest = AsyncTestCase( "AsyncTest" );

/**
 * Test that variables are defined
 */
AsyncTest.prototype.test__source_is_well_formed = function()
{
  assertTrue( Async != null );
  assertTrue( Async.dispatch != null );
};

//-------------------------------------------------------
// Utility
//-------------------------------------------------------
/**
 * Retrieve the internal state property. Defined as a utility function with the tests because it's not an ordinary
 * interface.
 *
 * @return {Async.Action.State}
 */
Async.Asynchronous_Action.prototype.get_state = function()
{
  // Member '_state' marked as private. No warning if accessed in a prototype method.
  return this._state;
};

//-------------------------------------------------------
// Generic tests
//-------------------------------------------------------
function verify_phase()
{
}

/**
 * Check that an action executes its body and returns. Generic for simple, non-compound actions.
 *
 * @param {function(function):Async.Asynchronous_Action_interface} factory
 *    A factory function that yields an action.
 * @param queue
 */
function simple_try( factory, queue )
{
  var d = null;
  var sequence = 0;

  queue.call( "Go phase.", function( callbacks )
  {
    var trial = callbacks.add( function()
    {
      assertEquals( Async.Action.State.Running, d.get_state() );
      sequence += 1;
    } );
    d = factory( trial );
    assertEquals( Async.Action.State.Ready, d.get_state() );
    assertEquals( 0, sequence );
    d.go();
    assertEquals( 0, sequence );
  } );

  queue.call( "End phase.", function()
  {
    assertEquals( 1, sequence );
    assertEquals( "action state is not 'Done'.", Async.Action.State.Done, d.get_state() );
  } );
}

/**
 * Check that an action executes its body and the finisher function and returns. Generic for simple, non-compound
 * actions. Verifying execution is done with both direct and indirect means.
 *
 * @param {function} factory
 *    A factory function that yields an action.
 * @param queue
 */
function simple_finally( factory, queue )
{
  /**
   * @type {Async.Asynchronous_Action}
   */
  var d;
  var sequence = 0;

  function catcher()
  {
    fail( "Action under test should not throw an exception nor call its catcher." );
  }

  function finisher()
  {
    sequence += 2;
  }

  queue.call( "Go phase.", function( callbacks )
  {
    var trial = callbacks.add( function()
    {
      sequence += 1;
    } );
    d = factory( trial );
    assertEquals( 0, sequence );
    var monitored_finisher = callbacks.add( finisher );
    d.go( monitored_finisher, catcher );
  } );

  queue.call( "End phase.", function()
  {
    assertEquals( 3, sequence );
    assertEquals( "action state is not 'Done'.", Async.Action.State.Done, d.get_state() );
  } );
}

/**
 * Run a simple trial, one that throws an exception, with both finally and catch functions. Indirectly verify that all
 * three run, but directly verify only the finally and catch.
 *
 * Generic for simple non-compound actions.
 *
 * @param {function} factory
 *    A factory function that yields an action.
 * @param queue
 */
function simple_catch( factory, queue )
{
  /**
   * @type {Async.Asynchronous_Action}
   */
  var d;
  var sequence = 0;

  function trial()
  {
    assertEquals( 0, sequence );
    sequence += 1;
    throw new Error( "This error is part of the test." );
  }

  function catcher()
  {
    assertEquals( 1, sequence );
    sequence += 2;
  }

  function finisher()
  {
    assertEquals( 3, sequence );
    sequence += 4;
  }

  queue.call( "Go phase.", function( callbacks )
  {
    /* If we monitor the trial by adding to the callback list, it will report the exception as an error, which is not
     * what we want. We indirectly test that it runs by incrementing the sequence number.
     */
    d = factory( trial );
    var monitored_catch = callbacks.add( catcher );
    var monitored_finally = callbacks.add( finisher );
    assertEquals( 0, sequence );
    d.go( monitored_finally, monitored_catch );
    assertEquals( 0, sequence );
  } );

  queue.call( "End phase.", function()
  {
    assertEquals( 7, sequence );
    assertEquals( "action state is not 'Exception'.", Async.Action.State.Exception, d.get_state() );
  } );
}


//-------------------------------------------------------
// Defer
//-------------------------------------------------------
/**
 * Factory for Defer objects
 * @param trial
 * @return {Async.Defer}
 */
function defer_factory( trial )
{
  return new Async.Defer( trial );
}

AsyncTest.prototype.test_defer_try = function( queue )
{
  simple_try( defer_factory, queue );
};

AsyncTest.prototype.test_defer_finally = function( queue )
{
  simple_finally( defer_factory, queue );
};

AsyncTest.prototype.test_defer_catch = function( queue )
{
  simple_catch( defer_factory, queue );
};


/**
 * Run a dispatch trial by itself. Verifies that the trial runs both directly, by registering it in the callback list,
 * and indirectly, by validating the sequence number at the end.
 * @param queue
 */
AsyncTest.prototype.test_defer_tries_OLD = function( queue )
{
  var d = null;
  var sequence = 0;

  queue.call( "Dispatch", function( callbacks )
  {
    var trial = callbacks.add( function()
    {
      sequence += 1;
    } );
    d = new Async.Defer( trial );
    assertEquals( Async.Action.State.Ready, d.get_state() );
    assertEquals( 0, sequence );
    d.go();
    assertEquals( 0, sequence );
  } );

  queue.call( "verify completion", function()
  {
    assertEquals( 1, sequence );
    assertEquals( "action state is not 'Done'.", Async.Action.State.Done, d.get_state() );
  } );
};

/**
 * Run a dispatch trial with a finally function. Verifies that the trial and the finally function execute, using both
 * direct and indirect means.
 * @param queue
 */
AsyncTest.prototype.test_defer_finalizes_OLD = function( queue )
{
  var d;
  var sequence = 0;

  function cleaner()
  {
    sequence += 2;
  }

  queue.call( "Dispatch", function( callbacks )
  {
    var trial = callbacks.add( function()
    {
      sequence += 1;
    } );
    d = new Async.Defer( trial );
    assertEquals( 0, sequence );
    var really_land = callbacks.add( cleaner );
    d.go( really_land );
  } );

  queue.call( "verify completion", function()
  {
    assertEquals( 3, sequence );
    assertEquals( "action state is not 'Done'.", Async.Action.State.Done, d.get_state() );
  } );
};

/**
 * Run a dispatch trial, one that throws an exception, with both finally and catch functions. Indirectly verify that all
 * three run, but directly verify only the finally and catch.
 * @param queue
 */
AsyncTest.prototype.test_defer_catches_OLD = function( queue )
{
  var d;
  var sequence = 0;

  function finisher()
  {
    assertEquals( 1, sequence );
    sequence += 2;
  }

  function cleaner()
  {
    sequence += 4;
  }

  queue.call( "Dispatch", function( callbacks )
  {
    /* If we monitor the trial by adding to the callback list, it will report the exception as an error, which is not
     * what we want. We indirectly test
     */
    var trial = function()
    {
      sequence += 1;
      throw new Error( "You aren't supposed to see this error." );
    };
    d = new Async.Defer( trial );
    assertEquals( 0, sequence );
    var monitored_catch = callbacks.add( finisher );
    var monitored_finally = callbacks.add( cleaner );
    d.go( monitored_finally, monitored_catch );
  } );

  queue.call( "verify completion", function()
  {
    assertEquals( 7, sequence );
    assertEquals( "action state is not 'Exception'.", Async.Action.State.Exception, d.get_state() );
  } );
};

//-------------------------------------------------------
// Delay
//-------------------------------------------------------

/**
 * Factory for Delay objects
 * @param delay
 * @param trial
 * @return {Async.Delay}
 */
function delay_factory( delay, trial )
{
  return new Async.Delay( trial, delay );
}

function simple_delay_factory( trial )
{
  return delay_factory( 2, trial );
}

AsyncTest.prototype.test_delay_tries = function( queue )
{
  simple_try( simple_delay_factory, queue );
};

AsyncTest.prototype.test_delay_finally = function( queue )
{
  simple_finally( simple_delay_factory, queue );
};

AsyncTest.prototype.test_delay_catch = function( queue )
{
  simple_catch( simple_delay_factory, queue );
};


/**
 * Run a dispatch trial by itself. Verifies that the trial runs both directly, by registering it in the callback list,
 * and indirectly, by validating the sequence number at the end.
 * @param queue
 */
AsyncTest.prototype.test_timer_tries_OLD = function( queue )
{
  var d = null;
  var sequence = 0;

  queue.call( "launch", function( callbacks )
  {
    var trial = callbacks.add( function()
    {
      sequence += 1;
    } );
    d = new Async.Delay( trial, 2 );
    assertEquals( Async.Action.State.Ready, d.get_state() );
    assertEquals( 0, sequence );
    d.go();
    assertEquals( 0, sequence );
  } );

  queue.call( "complete", function()
  {
    assertEquals( 1, sequence );
    assertEquals( "action state is not 'Done'.", Async.Action.State.Done, d.get_state() );
  } );
};
