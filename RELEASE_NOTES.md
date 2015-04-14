## Release Notes

### TBD

* Added support in `resolveRefs` to alter a remote request prior to sending the request _(Useful for authentication)_ _(Issue #12)_
* Fixed bug in `resolveRefs` where multiple remote references resulted in callback being called multiple times
* Updated `isRemotePointer` to handle relative references and file URL references _(Issue #9)_
* Updated `resolveRefs` to return resolution metadata _(What references were resolved, where they were located and what they resolved to)_
