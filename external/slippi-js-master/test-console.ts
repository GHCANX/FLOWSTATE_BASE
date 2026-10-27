import { ConsoleConnection } from "./src/node/console/consoleConnection.js";
import { ConnectionStatus } from "./src/node/console/types.js";

const conn = new ConsoleConnection();
conn.on("statusChange", (status) => {
  console.log("Status:", status);
});
conn.connect("127.0.0.1", 12345, false, 1000);
setTimeout(() => {
  console.log("Exiting");
  process.exit(0);
}, 5000);
