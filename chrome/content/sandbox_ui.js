let {Logger} = require( "logger" );
let {Encoding} = require( "encoding" );

var logger = new Logger( "sandbox" );

function sandbox_start()
{
    var log = logger.make_log();
    log( "Start" );

    var output_box = document.getElementById( "sandbox_output" );
    var write = function( s )
    {
        output_box.value += s;
    };

    var y = new Encoding.YAML_stream( write );
    y.logger.suppress( true );

    //-----------------------------------------------------------------------------------------
    write( "---\n" );
    write( "# 0\n" );
    y.write( "# Output generated with YAML_stream" );

    //-----------------------------------------------------------------------------------------
    write( "---\n" );
    write( "# 1\n" );
    Cu.reportError( "1." );
    var g = y.write( "Test string" );
    if ( g )
    {
        log( "1. error: immediate array spec returned non-null generator" );
    }

    //-----------------------------------------------------------------------------------------
    write( "---\n" );
    write( "# 2\n" );
    try
    {
        Cu.reportError( "2." );
        var test_array = [ "item 1", "item 2", [ "item 3.1", "item 3.2" ], { a: "item 4a", b: "item 4b" } ];
        y.write( test_array, Encoding.array() );
    }
    catch ( e )
    {
        Cu.reportError( "error in 2: " + e.toString() + "\n" + e.stack );
        throw e;
    }

    //-----------------------------------------------------------------------------------------
    write( "---\n" );
    write( "# 3\n" );
    try
    {
        Cu.reportError( "3." );
        /*
         * An array of deferred arrays.
         */
        y.write( [ "3" ], Encoding.array_stream() );
        y.sequence_start();
        for ( let i = 0 ; i < test_array.length ; ++i )
        {
            try
            {
                y.sequence_send( test_array[i] );
            }
            catch ( e )
            {
                if ( e !== StopIteration ) throw e;
                log( "3. StopIteration at " + i );
                break;
            }
        }
        y.sequence_stop();
    }
    catch ( e )
    {
        Cu.reportError( "error in 3: " + e.toString() + "\n" + e.stack );
        throw e;
    }

    //-----------------------------------------------------------------------------------------
    write( "---\n" );
    write( "# 4\n" );
    Cu.reportError( "4." );

    y.write( [ "4" ], Encoding.array_stream( Encoding.array_stream() ) );
    y.sequence_start();
    for ( let i = 0 ; i < 3 ; ++i )
    {
        y.sequence_start();
        let n = [1, 0, 2][ i ];
        for ( let j = 0 ; j < n ; ++j )
        {
            let s = "item " + ( i + 1 ) + "." + j;
            //log( "4. " + s );
            try
            {
                y.sequence_send( s );
            }
            catch ( e )
            {
                if ( e !== StopIteration ) throw e;
                log( "4. StopIteration at " + i + "," + j );
                throw e;
            }
        }
        y.sequence_stop();
    }
    y.sequence_stop();

    //-----------------------------------------------------------------------------------------
    write( "---\n" );
    write( "# 5\n" );
    Cu.reportError( "5." );

    var object_5 = {
        time_start: "now",
        instruction: {
            "this": "this",
            that: "that",
            the_other_thing: null
        }
    };
    var object_5_encoding = Encoding.as_object( [
        // prelude
        Encoding.immediate_fields( ["time_start", "instruction"] ),
        // observation
        Encoding.field( "observation", Encoding.array_stream() ),
        // postlude
        Encoding.immediate_fields( ["time_finish", "termination"] )
    ] );

    y.write( object_5, object_5_encoding );
    y.sequence_start();
    for ( let i = 0 ; i < 3 ; ++i )
    {
        y.sequence_send( { site: "site " + i, square: i*i } );
    }
    object_5.time_finish = "later";
    object_5.termination = "success";
    y.sequence_stop();

    //-----------------------------------------------------------------------------------------
    write( "---\n" );
    if ( !y.may_write() )
    {
        var failure_message = "FAILURE: object streamer ended in an incomplete state.";
        write( failure_message );
        Cu.reportError( failure_message );
    }
}
