let {Logger} = require( "logger" );
/**
 * The default value for runaway_limit, used only in the constructor.
 * @type {Number}
 */
const default_runaway_limit = 1000;

/**
 * Class for long-running tasks. Such tasks divide work into discrete units of effort, which allows them to be
 * interrupted and to post progress.
 * <p/>
 * Note that are no callback or events in this class. Any state feedback should be implemented as needed within the
 * task generator. task generator can distinguish cancellation by examining the rvalue of its yield statements. The
 * generator cannot detect being paused, but the control object that started the task can.
 * <p/>
 * PLANNED: There's no 'pause()' in this version. This is very similar to 'cancel()' except that it's restartable. The
 * code isn't particularly difficult, but it would require reworking the main 'run()' loop.
 * <p/>
 * PLANNED: The current version will handle AJAX calls by polling the task generator every millisecond to see if there
 * have been pending calls that have completed since the last poll. It would make for better performance for the task
 * to signal that it should pause execution and then continue only after a pending call completes. This would eliminate
 * run-time polling overhead.
 * <p/>
 * There would also need to be an interface presented to the task for pause and resume. Resuming is the harder one,
 * because the task needs an object to call when 'Long_Task.prototype.run' is not in the call stack. Currently, the
 * generator is instantiated before the constructor for this class, which means either passing such an object with
 * 'send()' if that constructor is to be called. The better way is likely for this class to instantiate the generator
 * with a pause/resume object as argument, but this only allows parametric generators (pretty much a requirement) if
 * if 'Function.protoype.bind()' works on generator-functions (untried) or if an equivalent can be hacked up.
 *
 * @param {Generator} task_generator
 *      The task generator is the task to be run, implemented as a generator. Each call to the generator performs an
 *      increment of computation, whose size is determined by the task. This is part of a cooperative multitasking
 *      system.
 *      <p/>
 *      Note that this argument is a generator, not the function that returns a generator when called. Instantiating
 *      the generator with a function call is the responsibility of the code that instantiates this class.
 *      <p/>
 *      Note 'task_generator.next()' is always called at least once, because 'run()' calls that method before it detects
 *      cancellation. This is required by the interface to a generator, since it's valid to call 'send()', which is how
 *      the runner signals cancellation to the task, only after the first call to 'next'. If, for whatever reason, it's
 *      necessary to detect cancellation before the work begins, the generator should have an extra do-nothing 'yield'
 *      statement at the beginning.
 *
 * @param {Number} [runaway_limit]
 *      The maximum number of iterations before 'run()' will throw an exception. Disable runaway detection by
 *      setting this value to zero.
 *
 */
var Long_Task = exports.Long_Task = function( task_generator, runaway_limit )
{
    /**
     * The runner is a generator that performs a single increment of computation with each call to next(). It returns
     * 'false' when it is not yet completed and 'true' once it has. Calling the generator with 'send( true )' notifies
     * the generator that it has been cancelled; thereafter it must return 'true' always.
     * @type {Function}
     */
    this.task_generator = task_generator;

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

    /**
     * The maximum number of iterations before 'run()' will throw an exception. Disable runaway detection by setting
     * this value to zero.
     * @type {Number}
     */
    this.runaway_limit = (arguments.length < 2) ? default_runaway_limit : runaway_limit;

    /**
     * Iteration counter. This is only incremented when a runaway limit is in effect.
     * @type {Number}
     */
    this.count = 0;

    /**
     * Internal timer. This is an nsITimer rather than the window time to allow background operation.
     * @type {nsITimer}
     */
    this.timer = Cc["@mozilla.org/timer;1"].createInstance( Ci.nsITimer );

    /**
     * Logging service.
     * @type {Logger}
     */
    this.logger = new Logger( "Long_Task" );
};

/**
 * Cancel command. Calling this function cancels the pending task as soon as possible, which is nowhere near
 * immediate with JavaScript.
 * <p/>
 * WARNING: The current way that cancellation is implemented, there will be one additional call to the task
 * generator before cancellation. If that's a problem, it's time to fix the algorithm, which means making
 * an initial call to 'next()' before setting up the standing loop, and swapping the order of iterating and checking
 * for cancellation.
 */
Long_Task.prototype.cancel = function()
{
    this.cancelled = true;
};

/**
 * Run command
 */
Long_Task.prototype.run = function()
{
    var log = this.logger.make_log( "run" );
    log( "Begin, runaway_limit = " + this.runaway_limit );

    if ( !this.runnable )
    {
        throw "Long_Task no longer runnable";
    }

    this._run_once();
};

/**
 * The main body of the runner.
 */
Long_Task.prototype._run_once = function()
{
    var log = this.logger.make_log( "_run_once" );

    /*
     * The bulk of this function is structure as 'do ... while( false )' in order to use 'break' for flow control,
     * instead of splitting off a second function and using 'return'.
     */
    do
    {
        /*
         * Main iteration call. The call to run() goes into a try-block to ensure we stop gracefully if the generator
         * throws, since that doesn't always signal an error
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
            if ( ex === StopIteration )
            {
                log( "End. Task iterator stopped" );
                /*
                 * StopIteration is not an error but just signals the end of data for an ordinary iterator. Since the
                 * generator has signalled us, we don't send any signal by calling 'send()'.
                 */
                break;
            }
            else
            {
                log( "Iteration exception " + ex.toString() );
                throw ex;
            }
        }

        /*
         * Runaway detection.
         */
        if ( this.runaway_limit > 0 )
        {
            ++this.count;
            log( "Iteration " + this.count, false );
            if ( this.count >= this.runaway_limit )
            {
                this.cancelled = true;
                /*
                 * FUTURE: This should really throw an exception after cancelling the generator.
                 */
            }
        }

        /*
         * Cancellation detection.
         */
        if ( this.cancelled )
        {
            log( "Cancellation begin" );
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
                /*
                 * StopIteration is not an error as a result of cancellation, but any other exception is.
                 */
                if ( ex !== StopIteration )
                {
                    log( "Cancellation exception: " + ex.toString() );
                    throw ex;
                }
            }
            log( "Cancellation end" );
            break;
        }

        /*
         * Infinite loop behavior happens here, where we schedule ourselves for another run as soon as possible
         * after we complete. In practice, this means "at the next millisecond timer tick, or after all event handlers
         * have run, whichever comes last". If the unit of computation is less than 50 ms, the duration overhead will be
         * over 1%, but it's just fine for scheduling asynchronous events where this internal timer is not the limiting
         * factor in total duration, such as AJAX calls.
         */
        this.timer.initWithCallback( this._run_once.bind( this ), 0, Ci.nsITimer.TYPE_ONE_SHOT );
        return;
    } while ( false )
    this.runnable = false;
};
