/**
 * Runs at document_start so console wrapper installs before page JS when possible.
 */
import "../../src/content/console-interceptor";
import { defineContentScript } from "wxt/sandbox";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    /* side-effect import only */
  },
});
