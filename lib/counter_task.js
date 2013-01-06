let {Logger} = require( "logger" );

/**
 * This task just counts.
 *
 * @param count
 *      The number of iterations.
 * @param count_notifier
 *      The count notifier is called once at each iteration with this current loop counter.
 * @param completion_notifier
 *      The completion notifier is called when the task is finished. Because a long running task does not run
 *      synchronously, we need some kind of notification system.
 */
var Counting_Task = exports.Counting_Task = function( count, count_notifier, completion_notifier )
{
    this.count = count;
    this.count_notifier = count_notifier;
    this.completion_notifier = completion_notifier;

    /**
     * Thread manager is used to make counting an asynchronous operation.
     * @type {nsIThreadManager}
     */
    this.thread_manager = Cc["@mozilla.org/thread-manager;1"].createInstance( Ci.nsIThreadManager );

    /**
     * This task uses a timer to slow down the count in order to provide a simulation of a slow task to exercise
     * pause-resume functionality.
     * @type {*}
     */
    this.timer = Cc["@mozilla.org/timer;1"].createInstance( Ci.nsITimer );

    this.logger = new Logger( "Counting_Task" );

    this.use_fast_version = true;
};

Counting_Task.prototype.dispatch = function()
{
    if ( this.use_fast_version )
    {
        this.thread_manager.currentThread.dispatch( { run: this.land }, Ci.nsIEventTarget.DISPATCH_NORMAL );
    }
};

/**
 * The generator for the task.
 *
 * @param {Function} pause
 * @param {Function} resume
 */
Counting_Task.prototype.generator = function( pause, resume )
{
    var log = this.logger.make_log( "task" );
    log( "begin" );

    /**
     * Flag indicating if there's a pending asynchronous operation.
     * @type {Boolean}
     */
    var pending = false;

    /**
     * Internal landing function. Defined here to gain access to scope variables.
     */
    this.land = function()
    {
        pending = false;
        resume();
    };

    var j;
    for ( j = 0 ; j < this.count ; ++j )
    {
        if ( !pending )
        {
            this.dispatch();
            pause();
            pending = true;
        }
        /*
         * The rvalue of a yield statement is the argument to 'send()' called on the generator. The task runner
         * calls 'send( true )' to indicated cancellation. 'next()' is a synonym for 'send( undefined )'. Thus,
         * the possible values for 'cancelled' are 'true' and 'undefined'.
         */
        // Note: the extra parentheses are a workaround for an IDEA defect about 'yield' as an rvalue.
        var cancelled = yield( false );
        if ( cancelled )
        {
            log( "cancelled" );
            break;
        }
        if ( this.count_notifier )
            this.count_notifier( j );
    }
    if ( j == this.count )
    {
        // Assert the loop terminated in the 'for' statement, not with a cancellation.
        log( "finished" )
    }
    if ( this.completion_notifier )
        this.completion_notifier();
    log( "end" );
};
