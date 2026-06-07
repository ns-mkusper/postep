const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("@expo/config-plugins");

const moduleSource = `package com.postep.mobile

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Arguments
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import android.net.Uri
import android.provider.DocumentsContract

class PostepContentUriModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "PostepContentUri"

  @ReactMethod
  fun readAsString(uriString: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      reactApplicationContext.contentResolver.openInputStream(uri).use { stream ->
        if (stream == null) {
          promise.reject("POSTEP_CONTENT_URI_READ", "Unable to open content URI")
          return
        }
        promise.resolve(InputStreamReader(stream, Charsets.UTF_8).readText())
      }
    } catch (error: Exception) {
      promise.reject("POSTEP_CONTENT_URI_READ", error)
    }
  }

  @ReactMethod
  fun listOrgFilesRecursively(uriString: String, maxDepth: Int, promise: Promise) {
    try {
      val entries = Arguments.createArray()
      val errors = Arguments.createArray()
      val seen = mutableSetOf<String>()
      val treeUri = Uri.parse(uriString)
      val rootDocumentId = DocumentsContract.getTreeDocumentId(treeUri)
      val rootDocumentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootDocumentId)

      visitDocument(treeUri, rootDocumentUri, 0, maxDepth, seen, entries, errors)

      val result = Arguments.createMap()
      result.putArray("entries", entries)
      result.putArray("errors", errors)
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("POSTEP_CONTENT_URI_LIST", error)
    }
  }

  @ReactMethod
  fun writeAsString(uriString: String, contents: String, promise: Promise) {
    try {
      val uri = Uri.parse(uriString)
      reactApplicationContext.contentResolver.openOutputStream(uri, "wt").use { stream ->
        if (stream == null) {
          promise.reject("POSTEP_CONTENT_URI_WRITE", "Unable to open content URI")
          return
        }
        OutputStreamWriter(stream, Charsets.UTF_8).use { writer -> writer.write(contents) }
        promise.resolve(null)
      }
    } catch (error: Exception) {
      promise.reject("POSTEP_CONTENT_URI_WRITE", error)
    }
  }

  private fun visitDocument(
    treeUri: Uri,
    documentUri: Uri,
    depth: Int,
    maxDepth: Int,
    seen: MutableSet<String>,
    entries: com.facebook.react.bridge.WritableArray,
    errors: com.facebook.react.bridge.WritableArray
  ) {
    val uriString = documentUri.toString()
    if (!seen.add(uriString) || depth > maxDepth) {
      return
    }

    val resolver = reactApplicationContext.contentResolver
    val documentId = DocumentsContract.getDocumentId(documentUri)
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, documentId)
    val projection = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE
    )

    try {
      resolver.query(childrenUri, projection, null, null, null).use { cursor ->
        if (cursor == null) {
          addError(errors, uriString, "Unable to query content URI directory")
          return
        }
        while (cursor.moveToNext()) {
          val childDocumentId = cursor.getString(0) ?: continue
          val name = cursor.getString(1) ?: ""
          val mimeType = cursor.getString(2) ?: ""
          if (shouldSkipName(name)) {
            continue
          }
          val childUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childDocumentId)
          if (mimeType == DocumentsContract.Document.MIME_TYPE_DIR) {
            visitDocument(
              treeUri = treeUri,
              documentUri = childUri,
              depth = depth + 1,
              maxDepth = maxDepth,
              seen = seen,
              entries = entries,
              errors = errors
            )
          } else if (isOrgFileName(name)) {
            addEntry(entries, childUri.toString(), name)
          }
        }
      }
    } catch (error: Exception) {
      addError(errors, uriString, error.message ?: error.toString())
      return
    }
  }

  private fun addEntry(
    entries: com.facebook.react.bridge.WritableArray,
    uri: String,
    name: String
  ) {
    val entry = Arguments.createMap()
    entry.putString("uri", uri)
    entry.putString("name", name)
    entries.pushMap(entry)
  }

  private fun isOrgFileName(name: String): Boolean {
    return name.lowercase().endsWith(".org")
  }

  private fun shouldSkipName(name: String): Boolean {
    val lower = name.lowercase()
    return name.startsWith(".#") ||
      (name.startsWith("#") && name.endsWith("#")) ||
      lower.endsWith("~") ||
      lower.endsWith(".bak") ||
      lower.endsWith(".tmp") ||
      lower.endsWith(".temp") ||
      lower.contains("undo-tree") ||
      lower == ".git" ||
      lower == ".hg" ||
      lower == ".svn" ||
      lower == "node_modules"
  }

  private fun addError(
    errors: com.facebook.react.bridge.WritableArray,
    uri: String,
    message: String
  ) {
    val error = Arguments.createMap()
    error.putString("uri", uri)
    error.putString("message", message)
    errors.pushMap(error)
  }
}
`;

const packageSource = `package com.postep.mobile

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class PostepContentUriPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(PostepContentUriModule(reactContext))
  }

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`;

function javaPackagePath(androidPackage) {
  return androidPackage.split(".").join(path.sep);
}

function patchMainApplication(contents) {
  if (contents.includes("PostepContentUriPackage()")) {
    return contents;
  }
  return contents.replace(
    "return PackageList(this).packages",
    [
      "val packages = PackageList(this).packages",
      "            packages.add(PostepContentUriPackage())",
      "            return packages",
    ].join("\n")
  );
}

module.exports = function withPostepContentUri(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const androidPackage = config.android?.package ?? "com.postep.mobile";
      const packageDir = path.join(
        config.modRequest.platformProjectRoot,
        "app/src/main/java",
        javaPackagePath(androidPackage)
      );
      fs.mkdirSync(packageDir, { recursive: true });
      fs.writeFileSync(path.join(packageDir, "PostepContentUriModule.kt"), moduleSource);
      fs.writeFileSync(path.join(packageDir, "PostepContentUriPackage.kt"), packageSource);

      const mainApplicationPath = path.join(packageDir, "MainApplication.kt");
      const mainApplication = fs.readFileSync(mainApplicationPath, "utf8");
      fs.writeFileSync(mainApplicationPath, patchMainApplication(mainApplication));
      return config;
    },
  ]);
};
