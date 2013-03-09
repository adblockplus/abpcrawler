const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import( "resource://gre/modules/XPCOMUtils.jsm" );
Cu.import( "resource://gre/modules/Services.jsm" );

var Command_Line = function()
{
};

Command_Line.prototype = {
    classDescription: "abpcrawler-command-line",
    classID: Components.ID( "{771575E6-62FE-48CB-BC24-EAEFDDC1CA1D}" ),
    contractID: "@adblockplus.org/abpcrawler/command-line;1",
    _xpcom_categories: [
        {
            category: "command-line-handler",
            // The entry starts with "k" so that it has slightly higher than ordinary priority than ordinary
            // command line handlers.
            entry: "k-abpcrawler"
        }
    ],
    helpInfo: "" +  //   -    -    -    -    -    -    -    -     -    -    -   | wrap here
        "AdBlock Plus Crawler\n" +
        "  -abpcrawler           Start a crawl. Must specify both an input and\n" +
        "                        an output.\n" +
        "  -input_file <path>    Use <path> as input file from which to compile\n" +
        "                        instructions for the crawl.\n" +
        "  -output_dir <path>    Use <path> as output directory to contain a\n" +
        "                        file of crawl results.\n" +
        "  -output_base <name>   Use <name> as the base name for a file of crawl\n" +
        "                        results. Optional. Default='crawl_results'.\n" +
        "  -max_tabs <N>         Maximum number of tabs for simultananeous\n" +
        "                        loading of target sites.\n"
};

Command_Line.prototype.QueryInterface = XPCOMUtils.generateQI( [ Ci.nsICommandLineHandler ] );

/**
 *
 * @param {nsICommandLine} command_line
 */
Command_Line.prototype.handle = function( command_line )
{
    if ( !command_line.handleFlag( "abpcrawler" ) )
    {
        /*
         * There's no '--abpcrawler' option on the command line. As a result we don't try to interpret any other
         * command line flags.
         */
        return;
    }
    /*
     * The '--abpcrawler' argument indicates that this invocation is designated as a crawl session. As a result,
     * we don't perform the default action, which is opening the start page in the browser for interactive use.
     */
    command_line.preventDefault = true;
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory( [Command_Line] );