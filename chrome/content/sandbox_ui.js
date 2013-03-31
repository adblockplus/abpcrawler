let {Logger} = require( "logger" );
let {Encoding} = require( "encoding" );
let {Action} = require( "action" );

var what = "actions";
var output_box;
function sandbox_start()
{
  output_box = document.getElementById( "sandbox_output" );
  switch ( what )
  {
    case "actions":
      exercise_actions();
      break;
  }
}

var write = function( s )
{
  output_box.value += s;
};

var logger = new Logger( "sandbox" );
var log = logger.make_log();

//=========================================================================================
// exercise_actions
//=========================================================================================
function exercise_actions()
{
  log( "Action" );

  //-----------------------------------------------------------------------------------------
  write( "---\n" );
  write( "# 0\n" );
  var t = typeof Action;
  write( "Action is " + ((t === 'undefined') ? "not " : "") + "defined."
    + " It is " + ((t === 'object') ? "" : "not") + "an object.\n" );
  var b = "Join" in Action;
  write( "Action.Join is a " + (b ? "valid " : "invalid") + "member.\n" );

  //-----------------------------------------------------------------------------------------
  write( "---\n" );
  write( "# 1\n" );
  var defer = new Action.Defer( function()
  {
    write( "Defer executed.")
  } );

  function catcher()
  {
    write( "Successfully caught.\n" );
  }

  function finisher()
  {
    write( "Finished." );
  }

  try
  {
    var join = new Action.Join_Timeout( defer, 10 );
    join.go( finisher, catcher );
  }
  catch ( e )
  {
    write( "Exception: " + e.message );
  }

}

