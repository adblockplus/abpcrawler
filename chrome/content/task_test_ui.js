/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

var {Long_Task} = require( "task" );

var current_task = null;

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

    var status_field = document.getElementById( "task_status" );
    status_field.removeChild( status_field.childNodes[0] );
    status_field.appendChild( document.createTextNode( status ) );
    log( status );
}

function task_start_click()
{
    if ( !current_task )
    {
        log( "Clicked start" );
        current_task = new Long_Task( Long_Task.tg_count( task_finished ), 5 );
        var status_field = document.getElementById( "task_status" );
        status_field.appendChild( document.createTextNode( "Started" ) );
        log( "Started" );
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
};

