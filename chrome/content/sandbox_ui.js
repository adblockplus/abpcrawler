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
            Encoding.deferred_array( "observation" ),
            // postlude
            Encoding.immediate_fields( ["time_finish", "termination"] )
        ] )
    };
    var test_2_encoding = {
        __encode_as__: Encoding.array_immediate()
    };
    var test_array = ["item 1", "item 2", "item 3"];

    var y = new Encoding.YAML_stream( write );

    y.write( "# Output generated with YAML_stream" );
    write( "---\n" );
    write( "# 1\n" );
    var g = y.write( "Test string" );
    if ( g )
    {
        log( "1. error: immediate array spec returned non-null generator" );
    }

    write( "---\n" );
    write( "# 2\n" );
    g = y.write( test_array, Encoding.array_immediate() );
    if ( g )
    {
        log( "2. error: immediate array spec returned non-null generator" );
    }

    write( "---\n" );
    write( "# 3\n" );
    g = y.write( [], Encoding.array_deferred() );
    if ( ! g )
    {
        log( "3. error: deferred array spec returned null generator" );
    }
    for ( let i = 0 ; i < test_array.length ; ++i )
    {
        try
        {
            g.send( test_array[i] );
        }
        catch ( e )
        {
            if ( e !== StopIteration ) throw e;
            log( "3. StopIteration at " + i );
            break;
        }
    }
    log( "3. Loop end" );
    y.write_stop();


}

