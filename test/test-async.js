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
// Dispatch
//-------------------------------------------------------
/**
 * Run a dispatch trial by itself. Verifies that the trial runs both directly, by registering it in the callback list,
 * and indirectly, by validating the sequence number at the end.
 * @param queue
 */
AsyncTest.prototype.test_defer_tries = function( queue )
{
  var d = null;
  var sequence = 0;

  queue.call( "Dispatch", function( callbacks )
  {
    var trial = callbacks.add( function()
    {
      sequence += 1;
    } );
    d = new Async.Dispatch( trial );
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
AsyncTest.prototype.test_defer_finalizes = function( queue )
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
    d = new Async.Dispatch( trial );
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
AsyncTest.prototype.test_defer_catches = function( queue )
{
  var d;
  var sequence = 0;

  function catcher()
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
    d = new Async.Dispatch( trial );
    assertEquals( 0, sequence );
    var monitored_catch = callbacks.add( catcher );
    var monitored_finally = callbacks.add( cleaner );
    d.go( monitored_finally, monitored_catch );
  } );

  queue.call( "verify completion", function()
  {
    assertEquals( 7, sequence );
    assertEquals( "action state is not 'Exception'.", Async.Action.State.Exception, d.get_state() );
  } );
};
