/**
 * Task class for long-running tasks. Such tasks divide work into discrete units of effort, which allows them to be
 * interrupted and to post progress.
 *
 * @param task_generator A yield-function that returns a generator when called.
 */
var Task = exports.Task = function ( task_generator, completion_notifier )
{
    /**
     * The runner is a generator that performs a single increment of computation with each call to next(). It returns
     * 'false' when it is not yet completed and 'true' once it has. Calling the generator with 'send( true )' notifies
     * the generator that it has been cancelled; thereafter it must return 'true' always.
     */
    this.task_generator = task_generator();

    /**
     * The completion notifier is called when the task is finished. Because a long running task does not run
     * synchronously, we need some kind of notification system. An alternative, raising an event, seems too
     * heavyweight for this purpose.
     */
    this.completion_notifier = completion_notifier;

    /**
     * Cancellation flag. Set in the cancel() method. Tested each iteration in run().
     * @type {Boolean}
     */
    this.cancelled = false;

    /**
     * Runnable flag. This is essentially the state variable of a two-state machine, which starts at "runnable" and
     * goes to "completed".
     */
    this.runnable = true;
};

/**
 * Cancel command. Calling this function cancels the pending task as soon as possible, which is nowhere near
 * immediate with JavaScript.
 */
Task.prototype.cancel = function ()
{
};

/**
 * Run command
 */
Task.prototype.run = function ()
{
    if ( !this.runnable )
    {
        throw "Task no longer runnable";
    }

    while ( true )
    {
        if ( this.cancelled )
        {
            /*
             * We've received a command to cancel from elsewhere. Notify the generator that we're shutting down and
             * exit the loop.
             */
            this.task_generator.send( true );
            break;
        }
        /*
         * The task generator goes into a try-block to ensure we can mark the task as not runnable if the generator
         * fails.
         */
        try
        {
            if ( task_generator.next() )
            {
                /*
                 * The task generator returned true, which means that it's finished.
                 */
                break;
            }
        }
        catch ( ex )
        {
            /*
             * The most common exception would be StopIteration, which isn't an error but just signals the end of
             * data for an ordinary iterator. If it's an exception as a result of an error, we end the loop just
             * the same.
             */
            break;
        }
    }
    this.runnable = false;
    this.completion_notifier();
};

Task.log = function ( msg )
{
    Cu.reportError( "Task: " + msg );
};

/**
 * This task generator just counts.
 */
Task.tg_count = function ()
{
    Task.log( "Runner start" );
    var cancelled = false;
    for ( let j = 0 ; j < 10000 ; ++j )
    {
        /*
         * If this generator is ever called with 'send( true )', it will have the effect of assigning 'true' to
         * 'cancelled'. Thus yielding with a variable rather than a constant allows us to cancel an ongoing operation.
         */
        yield cancelled;
        if ( cancelled )
        {
            Task.Log( "Runner cancelled" );
            break;
        }
    }
    // Finalize here
    yield( true  );
    Task.log( "Runner finish" );
    while ( true )
        yield true;
}
