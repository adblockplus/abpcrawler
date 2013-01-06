/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

var {Long_Task} = require( "task" );
var {Counting_Task} = require( "counter_task" );
let {Logger} = require( "logger" );

var current_task = null;

function update_status( s, perform_log )
{
    var status_field = document.getElementById( "task_status" );
    if ( status_field.childNodes.length > 0 )
    {
        status_field.removeChild( status_field.childNodes[0] );
    }
    status_field.appendChild( document.createTextNode( s ) );
    if ( arguments.length >= 2 && perform_log )
    {
        log( s );
    }
}

function update_button( b )
{
    var button = document.getElementById( "task_go" );
    if ( b )
    {
        button.label = "Cancel"
    } else
    {
        button.label = "Start"
    }

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
    update_button( false );
    current_task = null;
}

function task_count( n )
{
    update_status( "Count " + n, false );
}

/*
 * We're overloading the start button also to handle cancellation.
 */
function task_start_click()
{
    if ( !current_task )
    {
        log( "Clicked start" );
        if ( !Counting_Task )
        {
            log( "No Counting_Task" );
        }
        if ( !Long_Task )
        {
            log( "No Long_Task" );
        }
        log( "require counter_task: " + require( "counter_task" ).toString() );

        let count = document.getElementById( "task_count" ).value;
        let limit = document.getElementById( "task_limit" ).value;
        var variant;
        switch ( document.getElementById( "counting_variant" ).selectedIndex )
        {
            case 0:
                variant = { type: "continuous" };
                break;
            case 1:
                variant = { type: "segmented fast" };
                break;
            case 2:
                variant = { type: "segmented slow", interval: document.getElementById( "slow_interval" ).value};
                break;
            default:
                log( "Unknown variant. This is an implementation defect." );
                throw "bad variant";
        }
        current_task = new Long_Task( new Counting_Task( count, task_count, task_finished, variant ), false, limit );
        update_status( "Started" );
        update_button( true );
        current_task.run();
    }
    else
    {
        current_task.cancel();
        update_button( false );
        // We have a running task, so cancel it.
    }
}

var log = (new Logger( "task_ui" )).make_log();
