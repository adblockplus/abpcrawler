let {Logger} = require( "logger" );

function tab( indent )
{
    var s = "";
    for ( let i = indent ; i > 0 ; --i )
        s += "    ";
    return s;
}

var YAML = {};
YAML.array_mark = "- ";
YAML.array_extra = "  ";

YAML.stringify = function( object )
{
    return YAML.write( object, 0, "", "" );
};

YAML.log = (new Logger( "YAML/write" )).make_log();

/**
 * Recursive writer.
 * <p/>
 * The basic recursion principle is that the caller is responsible for indentation of the first line (perhaps the only
 * one) and the callee is responsible for all internal indentation. This is modified to account for the difference
 * between primitives and aggregates. The 'extra' is added before aggregates, but not before primitives.
 *
 * @param value
 * @param indent
 * @param primitive_extra
 * @param aggregate_extra
 */
YAML.write = function( value, indent, primitive_extra, aggregate_extra )
{
    var s = "";
    switch ( typeof value )
    {
        case "string":
        case "number":
            s += primitive_extra + value + "\n";
            break;
        case "boolean":
            s += primitive_extra + ( value ? "true" : "false" ) + "\n";
            break;
        case "object":
            if ( !value )
                break;
            let t = Object.prototype.toString.call( value );
            switch ( t )
            {
                case "[object Array]":
                    // Assert we have an array
                    for ( let i = 0 ; i < value.length ; ++i )
                    {
                        if ( i == 0 )
                        {
                            s += aggregate_extra;
                        }
                        else
                        {
                            s += tab( indent );
                        }
                        s += YAML.array_mark + YAML.write( value[ i ], indent + 1, "", YAML.array_extra );
                    }
                    break;
                case "[object Object]":
                    // Assert we have a generic object
                    if ( "toJSON" in value )
                    {
                        value = value.toJSON();
                    }
                    try
                    {
                        var keys = Object.keys( value );
                    }
                    catch ( e )
                    {
                        // Sometimes an object is not an object. Really.
                        s += primitive_extra + value.toString() + "\n";
                        break;
                    }
                    for ( let i = 0 ; i < keys.length ; ++i )
                    {
                        if ( i == 0 )
                        {
                            s += aggregate_extra;
                        }
                        else
                        {
                            s += tab( indent );
                        }
                        s += keys[ i ] + ":" + YAML.write( value[ keys[ i ] ], indent + 1, " ", "\n" + tab( indent + 1 ) );
                    }
                    break;
                default:
                    s += primitive_extra + value.toString() + "\n";
            }
            break;
        default:
            break;
    }
    return s;
};

//-------------------------------------------------------
// YAML_stream
//-------------------------------------------------------
/**
 * Stream output in YAML format.
 * @param {Function} sink
 *      Called with each string segment of the output in sequence.
 * @constructor
 */
var YAML_stream = function( sink )
{
    /**
     * Writer function.
     * @type {Function}
     */
    this.sink = sink;

    /**
     * A generator
     * @type {Generator}
     */
    this.formatter = null;

    this.logger = new Logger( "YAML_stream" );
};

/**
 *
 * @param value
 * @param [view]
 * @return {*}
 */
YAML_stream.prototype.write = function( value, view )
{
    return this.output_start( value, view, 0, "", "" );
};

YAML_stream.prototype.output_start = function( value, view, indent, primitive_extra, aggregate_extra )
{
    var f = this.output( view, indent, primitive_extra, aggregate_extra );
    this.formatter = f;
    f.next();
    try
    {
        return f.send( value );
    }
    catch ( e )
    {
        if ( e !== StopIteration ) throw e;
        return null;
    }
};

/**
 *
 * @param view
 * @param indent
 * @param primitive_extra
 * @param aggregate_extra
 */
YAML_stream.prototype.output = function( view, indent, primitive_extra, aggregate_extra )
{
    //var log = this.logger.make_log( "output(" + indent + ")" );
    //log( "called" );
    /*
     * We need a 'yield' statement at the beginning of this generator in order to get the control flow of recursive
     * calls correct. When we yield ordinarily to await an incoming value, we need to return a generator for the
     * recursive call. On the other hand we don't want that generator to do anything until we have the value, or at
     * least have started to receive that value.
     *
     * Thus we yield immediately, constructing a generator ready-to-go, but only
     * call next() on it after we've received a value through the return value of a yield statement.
     */
    var value = yield null;

    //log( "value = " + JSON.stringify( value ) );

    if ( !view )
        view = {};
    if ( !("type" in view) )
    {
        // Determine the encoding.
        if ( ( typeof value ) == "object" )
        {
            let t = Object.prototype.toString.call( value );
            switch ( t )
            {
                case "[object Array]":
                    view.type = Encoding.type.array;
                    break;
                case "[object Object]":
                    view.type = Encoding.type.object;
                    try
                    {
                        var keys = Object.keys( value );
                    }
                    catch ( e )
                    {
                        // Sometimes an object is not an object. Really.
                        view.type = Encoding.type.primitive;
                        if ( value == null )
                        {
                            value = "null";
                        }
                        break;
                    }
                    view.seq = Encoding.immediate_fields( keys );
                    break;
                default:
            }
        }
        else
        {
            view.type = Encoding.type.primitive;
        }
    }
    //log( "YAML_stream.output: view = " + JSON.stringify( view ) );

    switch ( view.type.id )
    {
        case Encoding.type.primitive.id:
            this.sink( primitive_extra + value.toString() + "\n" );
            break;
        case Encoding.type.object.id:
            let recurring_extra = "\n" + tab( indent + 1 );
            for ( let i = 0 ; i < view.seq.length ; ++i )
            {
                let field = view.seq[ i ];
                let k = field.key;
                this.sink( k + ":" );
                this.sink( ( i == 0 ) ? aggregate_extra : tab( indent ) );
                /*
                 * Create a recursive generator and start it with a dummy call to next(). Because of the initial yield
                 * statement at the beginning, the first call to next() can never throw StopIteration.
                 */
                let g = this.output( null, indent + 1, " ", recurring_extra );
                g.next();
                let v;
                if ( field.value_now )
                {
                    v = value[ k ];
                }
                else
                {
                    /*
                     * This value of 'g' will be returned from a call to send().
                     */
                    v = yield g;
                }
                /*
                 * Now invoke the sub-generator by sending it the value, either the immediate one we already had, or
                 * the one we received because our parent sent it to us.
                 */
                try
                {
                    yield g.send( v );
                }
                catch ( e )
                {
                    /*
                     * StopIteration is the ordinary exit from send() when there are no more deferred elements.
                     * If it's something else, it's an actual error.
                     */
                    if ( e !== StopIteration ) throw e;
                    //log( "StopIteration" );
                }
            }
            break;
        case Encoding.type.array.id:
            for ( let i = 0 ; i < value.length ; ++i )
            {
                this.sink( YAML.array_mark );
                this.sink( ( i == 0 ) ? aggregate_extra : tab( indent ) );
                let g = this.output( null, indent + 1, "", YAML.array_extra );
            }
            break;
        default:
            this.sink( primitive_extra + "\n" );
            break;
    }
    //log( "Stop" );
};


//-------------------------------------------------------
// Encoding
//-------------------------------------------------------

/**
 * The export object for this module.
 */
var Encoding = { YAML: YAML, YAML_stream: YAML_stream };
Encoding.type = {
    /**
     * A primitive value or opaque object whose members are not separately output. Uses toString() to provide a value.
     */
    primitive: { id: 0 },
    /**
     * A transparent object whose members are each listed.
     */
    object: { id: 1 },
    /**
     * An array object
     */
    array: { id: 2 }
};

Encoding.immediate_fields = function( keys )
{
    return keys.reduce( function( result, b )
    {
        result.push( { key: b, key_now: true, value_now: true } );
        return result;
    }, [] );
};

Encoding.deferred_array = function( key )
{
    return { key: key, key_now: true, value_now: false };
};

Encoding.immediate_array = function( key )
{
    return { key: key, key_now: true, value_now: true };
};

Encoding.as_object = function( encodings )
{
    return {
        type: Encoding.type.object,           // Since we're listing fields explicitly, it's a transparent object
        seq: encodings.reduce(
            function( result, item )
            {
                return result.concat( item );
            }
        )
    };
};

exports.Encoding = Encoding;