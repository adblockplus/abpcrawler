/**
 * Class for long-running tasks. Such tasks divide work into discrete units of effort, which allows them to be
 * interrupted and to post progress.
 *
 * @param task_generator A yield-function that returns a generator when called.
 */
var Long_Task = exports.Long_Task = function ( task_generator, completion_notifier )
{
    /**
     * The runner is a generator that performs a single increment of computation with each call to next(). It returns
     * 'false' when it is not yet completed and 'true' once it has. Calling the generator with 'send( true )' notifies
     * the generator that it has been cancelled; thereafter it must return 'true' always.
     * @type {Function}
     */
    this.task_generator = task_generator();

    /**
     * The completion notifier is called when the task is finished. Because a long running task does not run
     * synchronously, we need some kind of notification system. An alternative, raising an event, seems too
     * heavyweight for this purpose.
     * @type {Function}
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
     * @type {Boolean}
     */
    this.runnable = true;
};

/**
 * Cancel command. Calling this function cancels the pending task as soon as possible, which is nowhere near
 * immediate with JavaScript.
 */
Long_Task.prototype.cancel = function ()
{
};

/**
 * Run command
 */
Long_Task.prototype.run = function ()
{
    Long_Task.log( "run begin" );

    if ( !this.runnable )
    {
        throw "Long_Task no longer runnable";
    }

    var count = 0;

    while ( true )
    {
        ++count;
        Long_Task.log( "run iteration " + count );
        if ( count > 5 )
        {
            this.cancelled = true;
        }

        if ( this.cancelled )
        {
            Long_Task.log( "run cancelled" );

            try
            {
                /*
                 * We've received a command to cancel from elsewhere. Notify the generator that we're shutting down and
                 * exit the loop. We're doing this within a try-block because the generator will typically throw
                 * StopIteration at this point, which isn't an error.
                 */
                this.task_generator.send( true );
            }
            catch ( ex )
            {
                // Nothing happening here.
                /*
                 * What ought to happen here, for robustness, is to see if the exception is something other than
                 * StopIteration. If so, we can throw it, because it constitutes an error. We should at least log it
                 * as an error.
                 */
            }
            Long_Task.log( "run cancelled, send 'true' to task generator" );
            break;
        }
        /*
         * The task generator goes into a try-block to ensure we can mark the task as not runnable if the generator
         * fails.
         */
        try
        {
            if ( this.task_generator.next() )
            {
                /*
                 * The task generator returned true, which means that it's finished.
                 */
                break;
            }
        }
        catch ( ex )
        {
            Long_Task.log( "run iteration exception: " + ex.toString() );
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

Long_Task.log = function ( msg )
{
    Cu.reportError( "Long_Task: " + msg );
};

/**
 * This task generator just counts.
 */
Long_Task.tg_count = function ()
{
    Long_Task.log( "tg_count start" );
    for ( let j = 0 ; j < 10 ; ++j )
    {
        {
            /*
             * The rvalue of a yield statement is the argument to 'send()' called on the generator. The task runner
             * calls 'send( true )' to indicated cancellation. 'next()' is a synonym for 'send( undefined )'. Thus,
             * the possible values for 'cancelled' are 'true' and 'undefined'.
             */
            // Note: the extra parentheses around the argument to 'yield' are a workaround for an IDEA defect.
            var cancelled = yield( false );
            if ( cancelled )
            {
                Long_Task.log( "tg_count cancelled" );
                break;
            }
        }
    }
    Long_Task.log( "tg_count finish" );
};
