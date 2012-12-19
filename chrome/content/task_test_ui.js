/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

var {Long_Task} = require( "task" );
var {tg_count} = require( "counter_task" );

var current_task = null;

function update_status( s )
{
    var status_field = document.getElementById( "task_status" );
    if ( status_field.childNodes.length > 0 )
    {
        status_field.removeChild( status_field.childNodes[0] );
    }
    status_field.appendChild( document.createTextNode( s ) );
    log( s );
}

function task_finished()
{
    if ( current_task.cancelled )
    {
        var status = "Cancelled";
    }
    else
    {
        status = "Finished";
    }
    update_status( status );
    current_task = null;
}

function task_count( n )
{
    update_status( "Count " + n );
}

/*
 * We're overloading the start button also to
 */
function task_start_click()
{
    if ( !current_task )
    {
        log( "Clicked start" );
        current_task = new Long_Task( tg_count( 10, task_count, task_finished ), 15 );
        update_status( "Started" );
        current_task.run();
    }
    else
    {
        // We have a running task, so cancel it.
    }
}


function log( msg )
{
    Cu.reportError( "task_ui: " + msg );
}
