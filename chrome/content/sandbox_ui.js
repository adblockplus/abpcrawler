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

    var test_instance = {
        time_start: Logger.timestamp(),
        instruction: { this: "this", that: "that", the_other_thing: null },
        observation: []
    };
    var test_encoding = {
        __encode_as__: Encoding.as_object( [
            // prelude
            Encoding.immediate_fields( ["time_start", "instruction"] ),
            // observation
            Encoding.field( "observation", Encoding.array( false ) ),
            //Encoding.array_deferred( "observation" ),
            // postlude
            Encoding.immediate_fields( ["time_finish", "termination"] )
        ] )
    };

    var y = new Encoding.YAML_stream( write );

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
    Cu.reportError( "2." );
    var test_array = ["item 1", "item 2", "item 3"];
    g = y.write( test_array, Encoding.array() );
    if ( g )
    {
        log( "2. error: immediate array spec returned non-null generator" );
    }

    //-----------------------------------------------------------------------------------------
    write( "---\n" );
    write( "# 3\n" );
    Cu.reportError( "3." );
    /*
     * An array of deferred arrays.
     */
    y.write( [], Encoding.array() );
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

    //-----------------------------------------------------------------------------------------
    write( "---\n" );
    write( "# 4\n" );
    Cu.reportError( "4." );
    var test4_view = {
        __view__: Encoding.array( false )

    };

    g = y.write( [], Encoding.array( false, Encoding.array( false ) ) );
    y.sequence_start();
    for ( let i = 0 ; i < 3 ; ++i )
    {
        y.sequence_start();
        for ( let j = 0 ; j <= i ; ++j )
        {
            let s = "item " + ( i + 1 ) + "." + j;
            log( "4. " + s );
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
}

