import {PipelineItem, Stage, transform} from "@blitzjs/file-pipeline"
import {readFile} from "fs"
import {pathExists} from "fs-extra"
import debounce from "lodash/debounce"
import path from "path"
import File from "vinyl"
import {ServerEnvironment} from "../../config"
const debug = require("debug")("blitz:manifest")

type ManifestVO = {
  keys: {[k: string]: string}
  values: {[k: string]: string}
}

export class Manifest {
  private keys: {[k: string]: string} = {}
  private values: {[k: string]: string} = {}
  private events: string[] = []

  constructor(obj?: ManifestVO) {
    if (obj) {
      this.keys = obj.keys
      this.values = obj.values
    }
  }

  getByKey(key: string) {
    return this.keys[key]
  }

  getByValue(value: string) {
    return this.values[value]
  }

  setEntry(key: string, dest: string) {
    debug("Setting key: " + key)
    this.keys[key] = dest
    this.values[dest] = key
    this.events.push(`set:${dest}`)
  }

  removeKey(key: string) {
    debug("Removing key: " + key)
    const dest = this.getByKey(key)
    if (!dest) {
      throw new Error(`Key "${key}" returns`)
    }
    delete this.values[dest]
    delete this.keys[key]
    this.events.push(`del:${key}`)
    return dest
  }

  getEvents() {
    return this.events
  }

  toJson(compact = false) {
    return JSON.stringify(this.toObject(), null, compact ? undefined : 2)
  }

  toObject() {
    return {
      keys: this.keys,
      values: this.values,
    }
  }

  static create(obj?: ManifestVO) {
    return new Manifest(obj)
  }
}

/**
 * Returns a stage to create and write the file error manifest so we can
 * link to the correct files on a NextJS browser error.
 */
export const createStageManifest = async (
  writeManifestFile: boolean = true,
  buildFolder: string,
  env: ServerEnvironment,
  manifestPath: string = "_manifest.json",
) => {
  let manifest: Manifest

  if (env !== "prod" && (await pathExists(path.join(buildFolder, manifestPath)))) {
    manifest = await ManifestLoader.load(path.join(buildFolder, manifestPath))
  } else {
    manifest = Manifest.create()
  }

  const stage: Stage = () => {
    const debouncePushItem = debounce((push: (item: PipelineItem) => void, file: PipelineItem) => {
      push(file)
    }, 500)

    const stream = transform.file((file, {next, push}) => {
      push(file) // Send file on through to be written

      const [origin] = file.history
      const dest = file.path

      if (file.event === "add" || file.event === "change") {
        debug("event:", file.event)
        manifest.setEntry(origin, dest)
      }

      if (file.event === "unlink" || file.event === "unlinkDir") {
        debug("event:", file.event)
        manifest.removeKey(origin)
      }

      if (writeManifestFile) {
        debouncePushItem(
          push,
          new File({
            // NOTE:  no need to for hash because this is a manifest
            //        and doesn't count as work
            path: manifestPath,
            contents: Buffer.from(manifest.toJson(false)),
          }),
        )
      }
      next()
    })

    return {stream, ready: {manifest}}
  }
  return stage
}

export const ManifestLoader = {
  load(filename: string) {
    return new Promise<Manifest>((resolve, reject) => {
      readFile(filename, "utf8", (err, data) => {
        if (err) {
          return reject(err)
        }
        resolve(Manifest.create(JSON.parse(data)))
      })
    })
  },
}
