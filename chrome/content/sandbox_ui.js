let {Logger} = require( "logger" );
let {Encoding} = require( "encoding" );

var logger = new Logger( "sandbox" );

function sandbox_start()
{
    var log = logger.make_log();
    log( "Start" );

    var log_box = document.getElementById( "sandbox_output" );

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

    var y = new Encoding.YAML_stream(
        function( s )
        {
            log_box.value += s;
        }
    );

    y.write( { YAML: "Output generated with YAML_stream" } );
    var g = y.write( ["item 1", "item 2", "item 3"], Encoding.array_immediate() );

    //log( "g = " + g.toString() );

}

