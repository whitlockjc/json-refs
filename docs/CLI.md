json-refs provides a simple CLI that provides various utilities.  Below is more information on how the json-refs can be
used and what to expect.

## Global Help

The global help for `json-refs` can be requested by doing any of the following:

* Running `json-refs` without any other arguments
* Running `json-refs` with the `help` command *(Example: `json-refs help`)*
* Running `json-refs` with the `-h` or `--help` flag *(Example: `json-refs --help`)*
* Running `json-refs` with an unsupported comand *(Example: `json-refs unsupported`)*

Here is the current global help output:

```

  Usage: json-refs [options] [command]


  Commands:

    help [command]                Display help information
    resolve [options] <location>  Prints document at location with its JSON References resolved

  Options:

    -h, --help     output usage information
    -V, --version  output the version number


```

## Available Commands

Below is the list of supported commands for `json-refs`:

* `help [command]`: This will print out command-specific help or the global help if no command is provided
* `resolve <location>` This will retrieve the document at the requested location, resolve its JSON References based
on the provided arguments and print the resolved document to standard out

For more details on each command, view the command-specific information below

### The `help` Command

The `help` command is there to either print global help, as discussed above, or to print command-specific help.  This
command is self-explanatory so there is not much to discuss here.

### The `resolve` Command

The `resolve` command takes a required `location` argument, which is either a local filesystem path or a remote URL,
retrieves the document, resolves the requested JSON References and then prints the resolved document.  This is basically
a wrapper for [JsonRefs.resolveRefsAt](https://github.com/whitlockjc/json-refs/blob/master/docs/API.md#module_JsonRefs.resolveRefsAt).

### Caveats

Below are a few things that are worth mentioning but cannot fit into the command help:

* `json-refs` only works with JSON and YAML files at this time
* The `-H|--header` option for `json-refs` requires a pattern like this: `<HEADER_NAME>: <HEADER_VALUE>` *(Notice the
space after the colon, it is **required**)*
* `json-refs`, like its API, does not error out in the event of invalid references.  In the event that your resolved
document does not look as you would expect, that is likely because some references were unresolvable.  To identify if
this is the case, or just to ensure your documents validate fully, use the `--validate` flag.

### Help

```

  Usage: resolve [options] <location>

  Prints document at location with its JSON References resolved

  Options:

    -h, --help             output usage information
    -H, --header <header>  The header to use when retrieving a remote document
    -I, --filter <type>    The type of JSON References to resolved
    -S, --validate         Fail when the document has invalid JSON References
    -y, --yaml             Output as YAML


```

### Examples

Here are a few examples:

#### Basic Authentication

`json-refs resolve http://somesecurehost/some/secure/path/swagger.yaml -H 'Basic: anNvbi1yZWZzOmlmIHlvdSBjYW4gcmVhZCB0aGlzLCBJIGFtIHNvcnJ5'`

#### Resolve only remote references

**Note:** There are two types of remote references, `relative` and `remote`.

`json-refs resolve https://cdn.rawgit.com/whitlockjc/json-refs/master/test/browser/documents/test-document.yaml --filter relative --filter remote`

#### Validate the Document

`json-refs resolve https://cdn.rawgit.com/whitlockjc/json-refs/master/test/browser/documents/test-document.yaml --validate`
