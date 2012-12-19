/**
 * This task generator just counts.
 *
 * @param completion_notifier
 *      The completion notifier is called when the task is finished. Because a long running task does not run
 *      synchronously, we need some kind of notification system.
 */
exports.tg_count = function ( completion_notifier )
{
    tg_log( "tg_count start" );
    for ( let j = 0 ; j < 10 ; ++j )
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
            tg_log( "tg_count cancelled" );
            break;
        }
    }
    if ( completion_notifier )
        completion_notifier();
    tg_log( "tg_count finish" );
};


function tg_log( msg )
{
    Cu.reportError( "tg_count: " + msg );
}
