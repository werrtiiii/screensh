using System;
using System.IO;
using System.Linq;
namespace ScreenSh.Windows
{
    static class Program
    {
        [STAThread]
        static int Main(string[] args)
        {
            AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false);
            AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false);
            try
            {
#if UPDATER
                if (args.Length == 0 && Path.GetFileName(Common.Self).Equals("recover.exe", StringComparison.OrdinalIgnoreCase))
                {
                    string directory = Path.GetDirectoryName(Common.Self), job = Path.Combine(directory, "job.json");
                    var user = new System.Security.Principal.WindowsPrincipal(System.Security.Principal.WindowsIdentity.GetCurrent());
                    if (!user.IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator))
                    {
                        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(Common.Self, "--recover-ui " + Common.Quote(job) + " " + Common.Quote(directory)) { UseShellExecute = true, Verb = "runas", WorkingDirectory = directory });
                        return 0;
                    }
                    return Updater.Window(job, directory);
                }
                if (args.Length == 2 && args[0] == "--update") return Updater.Window(args[1], null);
                if (args.Length == 2 && args[0] == "--worker") { new FileUpdate(new UpdateJob(args[1])).Apply(); return 0; }
                if (args.Length == 3 && args[0] == "--recover") { new FileUpdate(new UpdateJob(args[1])).Recover(args[2]); return 0; }
                if (args.Length == 3 && args[0] == "--recover-ui") return Updater.Window(args[1], args[2]);
                if (args.Length == 7 && args[0] == "--bootstrap") return Updater.Bootstrap(args[1], args[2], Int32.Parse(args[3]), args[4] == "true", args[5] == "true", args[6] == "true");
#else
                Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            if (args.Length == 2 && args[0] == "verify-signature") { Console.WriteLine(Common.Json.Serialize(Signature.Verify(args[1]))); return 0; }
                if (args.Length == 1 && args[0] == "self-test")
                {
                    Console.WriteLine("{\"runtime\":\"windows\",\"version\":1}");
                    return 0;
                }
                if (args.Length == 2 && args[0] == "ipv6")
                {
                    Console.WriteLine(Common.Json.Serialize(Platform.Ipv6(args[1] == "enable")));
                    return 0;
                }
                if (args.Length == 5 && args[0] == "login")
                {
                    Console.WriteLine(Platform.Login(args[1], args[2], args[3], args[4]) ? "true" : "false");
                    return 0;
                }
                if (args.Length == 2 && args[0] == "processes")
                {
                    var rows = Common.Processes().Where(p => Common.S(p, "name").StartsWith("voice-obs-", StringComparison.OrdinalIgnoreCase) || new[] { "obs64.exe", "obs-nvenc-test.exe", "obs-amf-test.exe", "obs-qsv-test.exe" }.Contains(Common.S(p, "name"), Common.CI)).ToList();
                    if (rows.Any(p => Common.S(p, "path") == ""))
                        throw new IOException("Cannot inspect OBS process paths");
                    Console.WriteLine(Common.Json.Serialize(rows.Select(p => Common.S(p, "path")).ToArray()));
                    return 0;
                }
                if (args.Length == 4 && args[0] == "stop-installed")
                    return Common.StopInstalled(args[1], Int32.Parse(args[2]), args[3] == "inspect");
                if (args.Length == 3 && args[0] == "prepare-upgrade")
                {
                    Common.PrepareUpgrade(args[1], args[2]);
                    return 0;
                }
                if (args.Length == 4 && args[0] == "firewall")
                {
                    Console.WriteLine(Common.Json.Serialize(Platform.Firewall(args[1], args[2], args[3] == "apply")));
                    return 0;
                }
                if (args.Length == 2 && args[0] == "firewall-select")
                {
                    var data = Common.Read(args[1]);
                    Console.WriteLine(Common.Json.Serialize(Platform.SelectFirewall(FileUpdate.Rows(data["rules"]), new System.Collections.Generic.HashSet<string>(((System.Collections.IEnumerable)data["present"]).Cast<object>().Select(Convert.ToString), Common.CI), Common.S(data, "interfaceName"), Common.B(data, "legacy"))));
                    return 0;
                }
#endif
                throw new ArgumentException("Invalid ScreenSh helper arguments");
            }
            catch (Exception error)
            {
                try
                {
                    Console.Error.WriteLine(Environment.GetEnvironmentVariable("SCREENSH_HELPER_DEBUG") == "1" ? error.ToString() : error.Message);
                }
                catch { }
#if UPDATER
  try{File.AppendAllText(Path.Combine(Path.GetDirectoryName(Common.Self),"native-error.log"),DateTime.UtcNow.ToString("o")+" "+error.ToString()+Environment.NewLine);}catch{}
#endif
                return 1;
            }
        }
    }
}
