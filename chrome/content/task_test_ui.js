/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

var {Task} = require( "task" );

var current_task = null;

function task_finished()
{
    var status_field = document.getElementById( "task_status" );
    status_field.removeChild( status_field.childNodes[0] );
    status_field.appendChild( document.createTextNode( "Finished" ) );
    Task.log( "Finished" );
}

function task_start_click()
{
    Task.log( "Clicked start" );
    current_task = new Task( Task.tg_count, task_finished );
    var status_field = document.getElementById( "task_status" );
    status_field.appendChild( document.createTextNode( "Started" ) );
    Task.log( "Started" );
    current_task.run();
}
