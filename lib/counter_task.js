/**
 * This task generator just counts.
 *
 * @param count_notifier
 *      The count notifier is called once at each iteration with this current loop counter.
 * @param completion_notifier
 *      The completion notifier is called when the task is finished. Because a long running task does not run
 *      synchronously, we need some kind of notification system.
 */
exports.tg_count = function ( count, count_notifier, completion_notifier )
{
    tg_log( "begin" );
    var j;
    for ( j = 0 ; j < count ; ++j )
    {
        /*
         * The rvalue of a yield statement is the argument to 'send()' called on the generator. The task runner
         * calls 'send( true )' to indicated cancellation. 'next()' is a synonym for 'send( undefined )'. Thus,
         * the possible values for 'cancelled' are 'true' and 'undefined'.
         */
        // Note: the extra parentheses are a workaround for an IDEA defect about 'yield' as an rvalue.
        var cancelled = yield( false );
        if ( cancelled )
        {
            tg_log( "cancelled" );
            break;
        }
        if ( count_notifier )
            count_notifier( j );
    }
    if ( j == count )
    {
        // Assert the loop terminated in the 'for' statement, not with a cancellation.
        tg_log( "finished" )
    }
    if ( completion_notifier )
        completion_notifier();
    tg_log( "end" );
};


function tg_log( msg )
{
    Cu.reportError( "tg_count: " + msg );
}
