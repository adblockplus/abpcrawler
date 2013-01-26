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

    this.logger = new Logger( "YAML_stream" );

    this.stack = [];

    this.endmark = false;
};

/**
 *
 * @param value
 * @param [view]
 * @return {*}
 */
YAML_stream.prototype.write_VERSION_1 = function( value, view )
{
    return this.output_start_VERSION_1( value, view, 0, "", "" );
};

YAML_stream.prototype.output_start_VERSION_1 = function( value, view, indent, primitive_extra, aggregate_extra )
{
    var f = this.output_VERSION_1( view, indent, primitive_extra, aggregate_extra );
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
YAML_stream.prototype.output_VERSION_1 = function( view, indent, primitive_extra, aggregate_extra )
{
    var log = this.logger.make_log( "output(" + indent + ")" );
    /*
     * We need a 'yield' statement at the beginning of this generator in order to get the control flow of recursive
     * calls correct. When we yield ordinarily to await an incoming value, we need to return a generator for the
     * recursive call. On the other hand we don't want that generator to do anything until we have the value, or at
     * least have started to receive that value.
     *
     * Thus we yield immediately, constructing a generator ready-to-go, but only call next() on it after we've received
     * a value through the return value of a yield statement.
     */
    var value = yield null;
    var v, g;

    if ( !view )
        view = {};
    if ( !("type" in view) )
    {
        // Determine the encoding.
        if ( value == null )
        {
            view.type = Encoding.type.null;
        }
        else if ( ( typeof value ) == "object" )
        {
            let t = Object.prototype.toString.call( value );
            switch ( t )
            {
                case "[object Array]":
                    view.type = Encoding.type.array;
                    view.value_now = true;
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
                    /*
                     * For example, [object Date]. They all have meaningful toString() implementations.
                     */
                    view.type = Encoding.type.primitive;
                    break;
            }
        }
        else
        {
            view.type = Encoding.type.primitive;
        }
    }
    log( "\n\tvalue = " + JSON.stringify( value )
        + "\n\tview = " + JSON.stringify( view ) );

    switch ( view.type.id )
    {
        case Encoding.type.null.id:
            this.sink( primitive_extra + "null\n" );
            break;
        case Encoding.type.primitive.id:
            this.sink( primitive_extra + value.toString() + "\n" );
            break;
        case Encoding.type.object.id:
            let recurring_extra = "\n" + tab( indent + 1 );
            for ( let i = 0 ; i < view.seq.length ; ++i )
            {
                let field = view.seq[ i ];
                let k = field.key;
                this.sink( ( i == 0 ) ? aggregate_extra : tab( indent ) );
                this.sink( k + ":" );
                /*
                 * Create a recursive generator and start it with a dummy call to next(). Because of the initial yield
                 * statement at the beginning, the first call to next() can never throw StopIteration.
                 */
                g = this.output_VERSION_1( null, indent + 1, " ", recurring_extra );
                g.next();
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
                }
            }
            break;
        case Encoding.type.array.id:
            if ( view.value_now )
            {
                log( "array value_now begin" );
                for ( let j = 0 ; j < value.length ; ++j )
                {
                    this.sink( YAML.array_mark );
                    this.sink( ( j == 0 ) ? aggregate_extra : tab( indent ) );
                    g = this.output_VERSION_1( null, indent + 1, "", YAML.array_extra );
                    g.next();
                    /*
                     * Now invoke the sub-generator by sending it the next value in the array. We don't need to yield
                     * to obtain this value.
                     */
                    try
                    {
                        yield g.send( value[ j ] );
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
                /*
                 * A zero-length array still needs a newline, since all values need one at the end of their output.
                 */
                if ( value.length == 0 )
                    this.sink( "\n" );
            }
            else
            {
                log( "array value_later begin" );
                // Assert view.value_now == false
                // Assert we have an deferred array to fetch
                let n_elements = 0;
                do
                {
                    var pf = "(array " + n_elements + ") ";
                    log( pf + "1. top of loop" );
                    this.sink( YAML.array_mark );
                    this.sink( ( n_elements == 0 ) ? aggregate_extra : tab( indent ) );
                    g = this.output_VERSION_1( null, indent + 1, "", YAML.array_extra );
                    log( pf + "2." );
                    g.next();
                    /*
                     * We must see if we have another value. If we don't, we abort the loop before calling send(),
                     * which is what actually triggers output.
                     *
                     * We don't test the value for a termination condition. Instead, the caller of this generator must
                     * call close() on it, which raises the StopIteration exception that we catch.
                     */
                    try
                    {
                        log( pf + "3a." );
                        v = yield g;
                        log( pf + "3b." );
                    }
                    catch ( e )
                    {
                        log( pf + "catch 4." );
                        if ( e !== StopIteration ) throw e;
                        /*
                         * Loop exit. We would close the generator here if abandoning it weren't just as workable.
                         */
                        log( pf + "catch 4. break" );
                        break;
                    }
                    try
                    {
                        log( pf + "5a." );
                        yield g.send( v );
                        log( pf + "5b." );
                        ++n_elements;                  // increment after output complete.
                    }
                    catch ( e )
                    {
                        log( pf + "catch 6." );
                        if ( e !== StopIteration ) throw e;
                        log( pf + "catch 6. end" );
                    }
                }
                while ( true );
                /*
                 * A zero-length array still needs a newline, since all values need one at the end of their output.
                 */
                if ( n_elements == 0 )
                    this.sink( "\n" );
                log( "array value_later end" )
            }
            break;
        default:
            this.sink( primitive_extra + "\n" );
            break;
    }
};

/**
 *
 * @param {*} view
 * @param {number} indent
 * @param {string} primitive_extra
 * @param {string} aggregate_extra
 * @param {*} [value]
 * @return {{view: *, indent: number, primitive_extra: string, aggregate_extra: string, value: *}}
 */
function frame( view, indent, primitive_extra, aggregate_extra, value )
{
    var x = {
        view: view,
        indent: indent,
        primitive_extra: primitive_extra,
        aggregate_extra: aggregate_extra,
        value: value
    };
    if ( arguments.length < 5 )
    {
        delete x.value;
    }
    return x;
}

YAML_stream.prototype.write_stop = function()
{
    this.endmark = true;
}

YAML_stream.prototype.write = function( value, view )
{
    /*
     * Obtain the generator and bring it to its first yield statement. Because we put a frame on the stack before
     * instantiating the generator, the generator will immediately yield, waiting for a value.
     */
    this.push( frame( view, 0, "", "", value ) );
    var g = this.machine();
    try
    {
        g.next();
        return g;
    }
    catch ( e )
    {
        if ( e !== StopIteration ) throw e;
        return null;
    }
};

/**
 * Stack processing machine for a depth-first traversal of an object tree structure where some of the nodes may
 * be deferred streams.
 */
YAML_stream.prototype.machine = function( value )
{
    while ( this.stack_is_nonempty() )
    {
        /*
         * @type {{view: *, indent: number, primitive_extra: string, aggregate_extra: string, value: *}}
         */
        var context = this.top();

        var log = this.logger.make_log( "output(" + this.stack.length + ")" );
        /*
         * Since there's an item on the stack, we need a value.
         */
        if ( this.endmark )
        {
            /*
             * An endmark is a pseudovalue used to mark the end of a stream of indeterminate length. Its main effect
             * is to suppress obtaining a value. There's an initialization here, but only as defensive programming.
             */
            value = undefined;
        }
        else if ( "value" in context )
        {
            value = context.value;
        }
        else
        {
            value = yield null;
        }

        if ( "view" in context )
        {
            var view = context.view
        }
        if ( !view )
        {
            view = {};
        }
        if ( !("type" in view) )
        {
            // Determine the encoding.
            if ( value == null )
            {
                view.type = Encoding.type.null;
            }
            else if ( ( typeof value ) == "object" )
            {
                let t = Object.prototype.toString.call( value );
                switch ( t )
                {
                    case "[object Array]":
                        view.type = Encoding.type.array;
                        view.value_now = true;
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
                        /*
                         * For example, [object Date]. They all have meaningful toString() implementations.
                         */
                        view.type = Encoding.type.primitive;
                        break;
                }
            }
            else
            {
                view.type = Encoding.type.primitive;
            }
        }

        log( "\n\tvalue = " + JSON.stringify( value )
            + "\n\tview = " + JSON.stringify( view ) );

        switch ( view.type.id )
        {
            case Encoding.type.null.id:
                this.sink( context.primitive_extra + "null\n" );
                this.pop();
                break;
            case Encoding.type.primitive.id:
                this.sink( context.primitive_extra + value.toString() + "\n" );
                this.pop();
                break;
            case Encoding.type.object.id:
                throw new Error( "Objects not implemented" );

                let recurring_extra = "\n" + tab( context.indent + 1 );
                for ( let i = 0 ; i < view.seq.length ; ++i )
                {
                    let field = view.seq[ i ];
                    let k = field.key;
                    this.sink( ( i == 0 ) ? context.aggregate_extra : tab( context.indent ) );
                    this.sink( k + ":" );
                    /*
                     * Create a recursive generator and start it with a dummy call to next(). Because of the initial yield
                     * statement at the beginning, the first call to next() can never throw StopIteration.
                     */
                    frame( null, context.indent + 1, " ", recurring_extra );
                }
                break;
            case Encoding.type.array.id:
                if ( !( "state" in context ) )
                {
                    context.state = { i: 0 };
                }
                if ( view.value_now )
                {
                    if ( context.state.i < value.length )
                    {
                        this.sink( YAML.array_mark );
                        this.sink( ( context.state.i == 0 ) ? context.aggregate_extra : tab( context.indent ) );
                        this.push( frame( null, context.indent + 1, "", YAML.array_extra, value[ context.state.i ] ) );
                        ++context.state.i;
                    }
                    else
                    {
                        this.pop();
                    }
                }
                else
                {
                    if ( this.endmark )
                    {
                        this.endmark = false;
                        this.pop();
                    }
                    else
                    {
                        /*
                         * We need a prefix so that we don't print it until after we know we have a value to print.
                         * There's no value argument in building the frame so that we obtain a deferred value in the
                         * next iteration.
                         */
                        let prefix = YAML.array_mark
                            + ( ( context.state.i == 0 ) ? context.aggregate_extra : tab( context.indent ) );
                        this.push( frame( null, context.indent + 1, prefix, prefix + YAML.array_extra ) );
                        ++context.state.i;
                    }
                }
                /*
                 * A zero-length array still needs a newline, since all values need one at the end of their output.
                 */
                if ( context.state.i == 0 )
                    this.sink( "\n" );
                break;
            default:
                this.sink( "\n" );
                break;
        }
    }
};
YAML_stream.prototype.push = function( x )
{
    this.stack.push( x );
};

YAML_stream.prototype.top = function()
{
    return this.stack[ this.stack.length - 1];
};

YAML_stream.prototype.pop = function()
{
    if ( this.stack.length == 0 )
        throw new Error( "Stack empty" );
    return this.stack.pop();
};

YAML_stream.prototype.stack_is_nonempty = function()
{
    return this.stack.length != 0;
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
    null: { id: 0 },
    /**
     * A primitive value or opaque object whose members are not separately output. Uses toString() to provide a value.
     */
    primitive: { id: 1 },
    /**
     * A transparent object whose members are each listed.
     */
    object: { id: 2 },
    /**
     * An array object
     */
    array: { id: 3 }
};

Encoding.immediate_fields = function( keys )
{
    return keys.reduce( function( result, key )
    {
        result.push( { key: key, value_now: true } );
        return result;
    }, [] );
};

Encoding.deferred_array = function( key )
{
    return { key: key, value_now: false };
};

Encoding.immediate_array = function( key )
{
    return { key: key, value_now: true };
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

/**
 */
Encoding.array_deferred = function()
{
    return {
        type: Encoding.type.array,
        value_now: false
    };
};

/**
 */
Encoding.array_immediate = function()
{
    return {
        type: Encoding.type.array,
        value_now: true
    };
};

exports.Encoding = Encoding;