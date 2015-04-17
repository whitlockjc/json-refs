## Release Notes

### v0.1.7 (2015-04-16)

* Added support in `resolveRefs` to alter a remote request prior to sending the request _(Useful for authentication)_
_(Issue #12)_
* Added support in `resolveRefs` to process the remote request responses
* Fixed bug in `resolveRefs` where multiple remote references resulted in callback being called multiple times
* Updated `isRemotePointer` to handle relative references and file URL references _(Issue #9)_
* Updated `resolveRefs` to return resolution metadata _(What references were resolved, where they were located and what
they resolved to)_
* Updated `resolveRefs` to return an `Error` whenever a relative reference is encountered or whenever a remote reference
uses an unsupported URL scheme
