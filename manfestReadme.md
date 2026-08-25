Outlook Manifest XML Fix
Problem
Outlook rejected the add-in during sideload with the following error:
> The VersionOverrides 1.1 section of the manifest is invalid. The resid tag is invalid.
The problem was in the `VersionOverridesV1_1` section of the Outlook manifest.
Manifest Fix
The XML declaration must remain the first line:
```xml
<?xml version="1.0" encoding="UTF-8"?>
```
The `VersionOverridesV1_0` remains the parent version override.
The `VersionOverridesV1_1` remains nested inside it:
```xml
<VersionOverrides
  xmlns="http://schemas.microsoft.com/office/mailappversionoverrides"
  xsi:type="VersionOverridesV1_0">

  ...

  <VersionOverrides
    xmlns="http://schemas.microsoft.com/office/mailappversionoverrides/1.1"
    xsi:type="VersionOverridesV1_1">

    ...

  </VersionOverrides>
</VersionOverrides>
```
For the `VersionOverridesV1_1` host, the runtime is explicitly declared:
```xml
<Hosts>
  <Host xsi:type="MailHost">
    <Runtimes>
      <Runtime resid="CommandsUrl" />
    </Runtimes>

    <DesktopFormFactor>
      ...
    </DesktopFormFactor>
  </Host>
</Hosts>
```
The `CommandsUrl` resource is defined in the same `Resources` section:
```xml
<Resources>
  <bt:Urls>
    <bt:Url
      id="TaskPaneUrl"
      DefaultValue="https://office.scomm.ai/taskpane.html" />
    <bt:Url
      id="CommandsUrl"
      DefaultValue="https://office.scomm.ai/commands.html" />
  </bt:Urls>
</Resources>
```
What Changed
Only the manifest XML structure was changed.
Added
```xml
<Runtimes>
  <Runtime resid="CommandsUrl" />
</Runtimes>
```
inside:
```xml
<Host xsi:type="MailHost">
```
in `VersionOverridesV1_1`.
Preserved
The following existing manifest values were not changed:
Add-in ID
Version
Provider
Permissions
URLs
Icons
Task pane URL
Commands URL
Resource IDs
SComm labels
Launch event function names
`WebApplicationInfo` configuration
Not Added
No generic `<Init>` element was added.
The XML declaration remains the first line:
```xml
<?xml version="1.0" encoding="UTF-8"?>
```
Result
The original manifest produced:
```text
Installation failed

The VersionOverrides 1.1 section of the manifest is invalid.
The resid tag is invalid.
```
The manifest was updated so that the `VersionOverridesV1_1` host explicitly declares:
```xml
<Runtimes>
  <Runtime resid="CommandsUrl" />
</Runtimes>
```
while keeping the existing SComm manifest configuration unchanged.