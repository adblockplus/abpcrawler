ActionTest = AsyncTestCase( "ActionTest" );

/**
 * Test that variables are defined
 */
ActionTest.prototype.test__source_is_well_formed = function()
{
  assertTrue( Action != null );
  assertTrue( Action.dispatch != null );
};

//-------------------------------------------------------
// Utility
//-------------------------------------------------------

//-------------------------------------------------------
// Generic tests
//-------------------------------------------------------
/**
 *
 * @param {Action.Asynchronous_Action} action
 * @param {string} state_name
 */
function verify_state( action, state_name )
{
  var expected = Action.State[ state_name ];
  assertEquals( "action state is not '" + state_name + "'.", expected, action.state );
}

/**
 * Check that an action executes its body and returns. Generic for simple, non-compound actions.
 *
 * @param {function} factory
 *    A factory function that yields an action.
 * @param queue
 */
function simple_try( factory, queue )
{
  /**
   * @type {Action.Asynchronous_Action}
   */
  var d = null;
  var sequence = 0;

  function trial()
  {
    verify_state( d, "Running" );
    sequence += 1;
  }

  queue.call( "Go phase.", function( callbacks )
  {
    var monitored_trial = callbacks.add( trial );
    d = factory( monitored_trial );
    verify_state( d, "Ready" );
    assertEquals( 0, sequence );
    d.go();
    verify_state( d, "Running" );
    assertEquals( 0, sequence );
  } );

  queue.call( "End phase.", function()
  {
    verify_state( d, "Done" );
    assertEquals( 1, sequence );
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
   * @type {Action.Asynchronous_Action}
   */
  var d;
  var sequence = 0;

  function trial()
  {
    verify_state( d, "Running" );
    sequence += 1;
  }

  function catcher()
  {
    fail( "Action under test should not throw an exception nor call its catcher." );
  }

  function finisher()
  {
    verify_state( d, "Done" );
    sequence += 2;
  }

  queue.call( "Go phase.", function( callbacks )
  {
    var monitored_trial = callbacks.add( trial );
    d = factory( monitored_trial );
    var monitored_finisher = callbacks.add( finisher );
    verify_state( d, "Ready" );
    assertEquals( 0, sequence );
    d.go( monitored_finisher, catcher );
    verify_state( d, "Running" );
    assertEquals( 0, sequence );
  } );

  queue.call( "End phase.", function()
  {
    verify_state( d, "Done" );
    assertEquals( 3, sequence );
  } );
}

/**
 * Run a simple trial, one that throws an exception, with both finisher and catcher. Indirectly verify that all
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
   * @type {Action.Asynchronous_Action}
   */
  var d;
  var sequence = 0;

  function trial()
  {
    verify_state( d, "Running" );
    assertEquals( 0, sequence );
    sequence += 1;
    throw new Error( "This error is part of the test." );
  }

  function catcher()
  {
    verify_state( d, "Exception" );
    assertEquals( 1, sequence );
    sequence += 2;
  }

  function finisher()
  {
    verify_state( d, "Exception" );
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
    verify_state( d, "Ready" );
    assertEquals( 0, sequence );
    d.go( monitored_finally, monitored_catch );
    verify_state( d, "Running" );
    assertEquals( 0, sequence );
  } );

  queue.call( "End phase.", function()
  {
    verify_state( d, "Exception" );
    assertEquals( 7, sequence );
  } );
}

/**
 * Run a simple trial, one that throws an exception, with both finisher and catcher. Indirectly verify that all
 * three run, but directly verify only the finally and catch.
 *
 * Generic for simple non-compound actions.
 *
 * @param {function} factory
 *    A factory function that yields an action.
 * @param queue
 */
function simple_abort( factory, queue )
{
  /**
   * @type {Action.Asynchronous_Action}
   */
  var d;
  var sequence = 0;

  function trial()
  {
    fail( "Executed trial when aborted." );
  }

  function catcher()
  {
    verify_state( d, "Exception" );
    assertEquals( 0, sequence );
    sequence += 2;
  }

  function finisher()
  {
    verify_state( d, "Exception" );
    assertEquals( 2, sequence );
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
    verify_state( d, "Ready" );
    assertEquals( 0, sequence );
    d.go( monitored_finally, monitored_catch );
    verify_state( d, "Running" );
    assertEquals( 0, sequence );
    d.abort();
    verify_state( d, "Exception" );
    assertEquals( 6, sequence );
  } );
}

function simple_value( factory, queue )
{
  /**
   * @type {Action.Asynchronous_Action}
   */
  var d;

  function trial()
  {
    return [ 1, "two" ];
  }

  function finisher( a, b )
  {
    assertEquals( 1, a );
    assertEquals( "two", b );
  }

  queue.call( "Phase[1] Go.", function( callbacks )
  {
    /* If we monitor the trial by adding to the callback list, it will report the exception as an error, which is not
     * what we want. We indirectly test that it runs by incrementing the sequence number.
     */
    d = factory( trial );
    var monitored_finally = callbacks.add( finisher );
    verify_state( d, "Ready" );
    d.go( monitored_finally );
    verify_state( d, "Running" );
  } );

  queue.call( "Phase[2] Complete.", function()
  {
    verify_state( d, "Done" );
  } );
}

//-------------------------------------------------------
// Defer
//-------------------------------------------------------
/**
 * Factory for Defer objects
 * @param trial
 * @return {Action.Defer}
 */
function defer_factory( trial )
{
  return new Action.Defer( trial );
}

ActionTest.prototype.test_defer_try = function( queue )
{
  simple_try( defer_factory, queue );
};

ActionTest.prototype.test_defer_finally = function( queue )
{
  simple_finally( defer_factory, queue );
};

ActionTest.prototype.test_defer_catch = function( queue )
{
  simple_catch( defer_factory, queue );
};

ActionTest.prototype.test_defer_abort = function( queue )
{
  simple_abort( defer_factory, queue );
};

ActionTest.prototype.test_simple_value = function( queue )
{
  simple_value( defer_factory, queue );
};

//-------------------------------------------------------
// Delay
//-------------------------------------------------------

/**
 * Factory for Delay objects
 * @param delay
 * @param trial
 * @return {Action.Delay}
 */
function delay_factory( delay, trial )
{
  return new Action.Delay( trial, delay );
}

function simple_delay_factory( trial )
{
  return delay_factory( 2, trial );
}

ActionTest.prototype.test_delay_tries = function( queue )
{
  simple_try( simple_delay_factory, queue );
};

ActionTest.prototype.test_delay_finally = function( queue )
{
  simple_finally( simple_delay_factory, queue );
};

ActionTest.prototype.test_delay_catch = function( queue )
{
  simple_catch( simple_delay_factory, queue );
};

//-------------------------------------------------------
// JM_Reporting implementation in Asynchronous_Action
//-------------------------------------------------------
var Asynchronous_Action__Test = AsyncTestCase( "Asynchronous_Action__Test" );

function assert_reporting_is_empty( action )
{
  if ( "_end_watchers" in action )
  {
    // If the array exists, everything in it must be null.
    var i;
    for ( i = 0 ; i < action._end_watchers.length ; ++i )
    {
      if ( action._end_watchers[ i ] )
        fail( "_end_watchers is still present and not empty." );
    }
  }
  // If the _end_watchers array is absent, then the outbound reporting links are absent and the test passes.
}


/*
 * Test plan: Make a simple action and join to it twice. Ensure that all mutual references are null everything
 * completes.
 */
Asynchronous_Action__Test.prototype.test_reporting__refencerences_are_absent_upon_completion = function( queue )
{
  var defer, join1, join2;

  function null_function()
  {
  }

  function reporting_has_watchers( action, n )
  {
    assertTrue( "_end_watchers" in action );
    assertEquals( n, action._end_watchers.length );
  }

  function attentive_is_empty( action )
  {
    assertNull( "joined_action should be null.", action.joined_action );
  }

  queue.call( "Phase[1]=Go.", function( callbacks )
  {
    // argument[2] is the number of times to expect this function
    var monitored_trial_function = callbacks.add( null_function, 1, 5000, "defer trial function" );
    var monitored_finisher_function = callbacks.add( null_function, 2, 5000, "join finisher function" );
    defer = new Action.Defer( monitored_trial_function );
    reporting_has_watchers( defer, 0 );
    join1 = new Action.Join( defer );
    join2 = new Action.Join( defer );
    reporting_has_watchers( defer, 0 );
    join1.go( monitored_finisher_function );
    reporting_has_watchers( defer, 1 );
    join2.go( monitored_finisher_function );
    reporting_has_watchers( defer, 2 );
    defer.go();
    verify_state( defer, "Running" );
    verify_state( join1, "Running" );
  } );

  queue.call( "Phase[2]=Complete.", function()
  {
    verify_state( defer, "Done" );
    verify_state( join1, "Done" );
    verify_state( join2, "Done" );
    assert_reporting_is_empty( defer );
    assert_reporting_is_empty( join1 );
    assert_reporting_is_empty( join2 );
    attentive_is_empty( join1 );
    attentive_is_empty( join2 );
  } );
};

Asynchronous_Action__Test.prototype.test_reporting__refencerences_are_absent_after_cancel = function( queue )
{
  var defer, join;

  function null_function()
  {
  }

  function reporting_has_watchers( action, n )
  {
    assertTrue( "_end_watchers" in action );
    assertEquals( n, action._end_watchers.length );
  }

  function attentive_is_empty( action )
  {
    assertNull( "joined_action should be null.", action.joined_action );
  }

  queue.call( "Phase[1]=Go.", function( callbacks )
  {
    // argument[2] is the number of times to expect this function
    var monitored_finisher_function = callbacks.add( null_function, 1, 5000, "join finisher function" );
    defer = new Action.Defer( null_function );
    reporting_has_watchers( defer, 0 );
    join = new Action.Join( defer );
    reporting_has_watchers( defer, 0 );
    join.go( monitored_finisher_function );
    reporting_has_watchers( defer, 1 );
    verify_state( defer, "Ready" );
    verify_state( join, "Running" );
    join.cancel();
    verify_state( defer, "Ready" );
    verify_state( join, "Done" );
    assert_reporting_is_empty( defer );
    assert_reporting_is_empty( join );
    attentive_is_empty( join );
  } );
};

//-------------------------------------------------------
// Join
//-------------------------------------------------------
ActionTest.prototype.test_join__throw_on_null_constructor_argument = function()
{
  try
  {
    new Action.Join( null );
    fail( "Join must throw an exception when passed a null constructor argument." );
  }
  catch ( e )
  {
    // Exception is what's supposed to happen.
  }
};

function join_test( variation, factory, queue )
/**
 * Combined variations on a number of simple join tests. There's an ordinary action and a join that it depends upon.
 * Both are invoked. The ordinary action executes first and then the join does.
 *
 * There are four operations {construct, go} x {ordinary, join} and some ordering dependencies. The construction of the
 * join must come after that of the ordinary action. Each invocation must come after construction. Given these
 * constraints, there are three possible orders.
 *
 * @param variation
 * @param factory
 * @param queue
 */
{
  var sequence = 0;
  var defer = null, join = null;

  function deferred_trial()
  {
    // The Defer instance should run first
    verify_state( defer, "Running" );
    assertEquals( "deferred trial. sequence", 0, sequence );
    sequence += 1;
  }

  function joined_catcher()
  {
    fail( "Joined catcher should not be called." );
  }

  function joined_finisher()
  {
    // The Join instance should run second.
    verify_state( defer, "Done" );
    verify_state( join, "Done" );
    assertEquals( "joined finisher. sequence", 1, sequence );
    sequence += 2;
  }

  function make_join()
  {
    join = factory( defer );
    verify_state( join, "Ready" );
  }

  function join_go( callbacks )
  {
    join.go( callbacks.add( joined_finisher, null, 2000, "joined finisher" ), joined_catcher );
  }

  queue.call( "Phase[1]=Go.", function( callbacks )
  {
    /*
     * Construction of the Defer instance always has to come first.
     */
    defer = new Action.Defer( callbacks.add( deferred_trial, null, 2000, "defer_trial" ) );
    verify_state( defer, "Ready" );
    switch ( variation )
    {
      case "existing ready":
        /*
         * Invoke the join before the defer has been invoked. This tests joining to a ready action.
         */
        make_join();
        join_go( callbacks );
        defer.go();
        verify_state( defer, "Running" );
        verify_state( join, "Running" );
        break;
      case "existing running":
        /*
         * Invoke the join after the defer has been invoked. This tests joining to a running action.
         */
        make_join();
        defer.go();
        join_go( callbacks );
        /*
         * The defer is running, but it hasn't completed yet, so the join hasn't completed yet. Contrast this with
         * the split version, where the defer action has already completed when we invoke the join.
         */
        verify_state( defer, "Running" );
        verify_state( join, "Running" );
        break;
      case "existing running split":
        /*
         * Invoke the defer after the join is invoked, but invoke the join later. This test ensures that the join
         * does not complete prematurely.
         */
        make_join();
        defer.go();
        verify_state( defer, "Running" );
        verify_state( join, "Ready" );
        break;
      case "new running":
        /*
         * Construct the join after defer has already been invoked.
         */
        defer.go();
        make_join();
        join_go( callbacks );
        verify_state( defer, "Running" );
        verify_state( join, "Running" );
        break;
      default:
        throw new Error( "unknown variation" );
    }
  } );

  queue.call( "Phase[2]=Intermediate.", function( callbacks )
  {
    switch ( variation )
    {
      case "existing running split":
        /*
         * The join should not yet have run at this point.
         */
        verify_state( defer, "Done" );
        verify_state( join, "Ready" );
        /*
         * We invoke the join on a completed action. As a result, the join will complete immediately.
         */
        join_go( callbacks );
        verify_state( defer, "Done" );
        verify_state( join, "Done" );
        break;
      default:
        /*
         * We're already verified the variation in the first phase. Some variations have no intermediate phase.
         */
        break;
    }
  } );

  queue.call( "Phase[3]=End.", function()
  {
    verify_state( defer, "Done" );
    verify_state( join, "Done" );
    assertEquals( 3, sequence );
  } );
}

function join_factory( action )
{
  return new Action.Join( action, Array.prototype.slice.call(arguments, 1) );
}

ActionTest.prototype.test_join__existing_join_to_new_defer_instance = function( queue )
{
  join_test( "existing ready", join_factory, queue );
};

ActionTest.prototype.test_join__existing_join_to_running_defer_instance = function( queue )
{
  join_test( "existing running", join_factory, queue );
};

ActionTest.prototype.test_join__existing_join_to_running_defer_instance__split = function( queue )
{
  join_test( "existing running split", join_factory, queue );
};

ActionTest.prototype.test_join__new_join_to_running_defer_instance = function( queue )
{
  join_test( "new running", join_factory, queue )
};


ActionTest__Join_Timeout = AsyncTestCase( "Join_Timeout" );

/*
 * Join_Timeout factory set at 15 seconds, which should be enough longer than callback limit, set to 2 seconds, to
 * avoid false negatives.
 */
function join_timeout_factory( action )
{
  return new Action.Join_Timeout( action, 15000 );
}

ActionTest__Join_Timeout.prototype.test_join_timeout__existing_join_to_new_defer_instance = function( queue )
{
  join_test( "existing ready", join_timeout_factory, queue );
};

ActionTest__Join_Timeout.prototype.test_join_timeout__existing_join_to_running_defer_instance = function( queue )
{
  join_test( "existing running", join_timeout_factory, queue );
};

ActionTest__Join_Timeout.prototype.test_join_timeout__existing_join_to_running_defer_instance__split = function( queue )
{
  join_test( "existing running split", join_timeout_factory, queue );
};

ActionTest__Join_Timeout.prototype.test_join_timeout__new_join_to_running_defer_instance = function( queue )
{
  join_test( "new running", join_timeout_factory, queue )
};


ActionTest__Join_Timeout.prototype.test_join_timeout__simple_timeout = function( queue )
{
  var sequence = 0;

  function defer_trial()
  {
    fail( "The trial on the defer object should not be called." );
  }

  function join_catch()
  {
    assertEquals( 0, sequence );
    sequence += 1;
    verify_state( defer, "Ready" );
    verify_state( join, "Exception" );
    assertTrue( "Join should be exceptional.", !join.completed_well );
  }

  function join_finally()
  {
  }

  /*
   * Construct the defer object outside the test queue because it does not generate a callback in this case.
   */
  var defer = new Action.Defer( defer_trial );
  verify_state( defer, "Ready" );
  var join;
  queue.call( "Phase[1]=Go.", function( callbacks )
  {
    /*
     * Timeout is set to a very short time.
     */
    join = new Action.Join_Timeout( defer, 1 );
    var monitored_join_catch = callbacks.add( join_catch, null, 1000, "join catch" );
    join.go( join_finally, monitored_join_catch );
  } );
  /*
   * No need to launch the Defer action. If the timeout doesn't trigger the catcher, the test fails.
   */
};

