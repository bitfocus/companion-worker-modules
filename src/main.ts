/*
 * This file is part of the Companion project
 * Copyright (c) 2022 Bitfocus AS
 * Authors: William Viker <william@bitfocus.io>, Håkon Nessjøen <haakon@bitfocus.io>
 *
 * This program is free software.
 * You should have received a copy of the MIT licence as well as the Bitfocus
 * Individual Contributor License Agreement for companion along with
 * this program.
 *
 * You can be released from the requirements of the license by purchasing
 * a commercial license. Buying such a license is mandatory as soon as you
 * develop commercial activities involving the Companion software without
 * disclosing the source code of your own applications.
 *
 */

import fs from 'fs'
import { execSync } from 'child_process'
import os from 'os'
import path from 'path'
import type { ModuleManifest } from '@companion-module/base'

const pkg = require('../package.json')

export interface CompanionModulesReport {
	generated_at: Date
	generated_by: string
	modules: CompanionModule[]
}

export interface CompanionModule {
	version: string
	// path: string
	name: string
	url: string
	help_url: string // Newer
	help_link: string // New
	api_version: string
	keywords: string[]
	manufacturer: string[] | string
	product: /* string | */ string[]
	shortname: string
	author: /* string | */ string[]
}

let errors: [string, any][] = []

let packages: CompanionModule[] = []

const main = async () => {
	console.log('[1] Starting', pkg.version)

	// delete folder recursive tmp/companion if it exists
	if (fs.existsSync('tmp/companion')) {
		console.log('[1.5] Deleting tmp/companion')
		fs.rmSync('tmp/companion', { recursive: true })
	}

	console.log('[2] Cloning companion')
	try {
		execSync('git clone https://github.com/bitfocus/companion ./tmp/companion --recursive')
	} catch (err) {
		console.log('[2] Error cloning companion')
		console.log(err)
		//errors.push(["clone", err]);
	}

	// create a list of modern packages
	console.log('[3] Reading bundled modules')
	const bundledModulesRoot = './tmp/companion/bundled-modules'
	const bundledModules = fs.readdirSync(bundledModulesRoot)
	for (const moduleFolder of bundledModules) {
		const moduleManifestPath = path.join(bundledModulesRoot, moduleFolder, 'companion/manifest.json')
		try {
			if (!fs.existsSync(moduleManifestPath)) continue

			const moduleManifest: ModuleManifest = JSON.parse(fs.readFileSync(moduleManifestPath, 'utf8'))

			packages.push({
				version: moduleManifest.version,
				name: moduleManifest.id,
				url: moduleManifest.repository,
				help_url: `https://raw.githubusercontent.com/bitfocus/companion-bundled-modules/main/${moduleManifest.id}/companion/HELP.md`,
				help_link: `https://github.com/bitfocus/companion-bundled-modules/blob/main/${moduleManifest.id}/companion/HELP.md`,
				api_version: moduleManifest.runtime.apiVersion,
				keywords: moduleManifest.keywords,
				manufacturer: moduleManifest.manufacturer,
				product: moduleManifest.products,
				shortname: moduleManifest.shortname,
				author: moduleManifest.maintainers.map((mt) => (mt.email ? `${mt.name} <${mt.email}>` : mt.name)),
			})
		} catch (err) {
			console.log('[3] Error reading manifest.json', moduleManifestPath)
			console.log(err)
			errors.push(['manifest.json', err])
		}
	}

	if (fs.existsSync('./tmp/companion/module-legacy')) {
		const addedPackages = new Set(packages.map((p) => p.name))

		// Run yarn in the companion folder
		console.log('[4] Running yarn')
		try {
			execSync('yarn --frozen-lockfile --prod', { cwd: './tmp/companion/module-legacy' })
		} catch (err) {
			console.log('[4] Error running yarn')
			console.log(err)
			errors.push(['yarn', err])
		}

		// read package.json in companion folder
		console.log('[5] Reading package.json')
		let package_json: any = {}
		try {
			package_json = JSON.parse(fs.readFileSync('./tmp/companion/module-legacy/package.json', 'utf8'))
		} catch (err) {
			console.log('[5] Error reading package.json')
			console.log(err)
			errors.push(['package.json', err])
		}

		// create a list of all packages
		if (package_json?.dependencies) {
			Object.keys(package_json.dependencies).forEach((key) => {
				if (key.startsWith('companion-module-')) {
					// read "./tmp/companion/node_modules/" + key + "/package.json"
					let sub_package_json: any = {}
					try {
						sub_package_json = JSON.parse(
							fs.readFileSync('./tmp/companion/module-legacy/node_modules/' + key + '/package.json', 'utf8'),
						)
					} catch (err) {
						console.log(
							'[5] Error reading sub package.json',
							'./tmp/companion/module-legacy/node_modules/' + key + '/package.json',
						)
						console.log(err)
						errors.push(['sub-package.json', err])
					}

					const name = key.replace('companion-module-', '')
					if (addedPackages.has(name)) return

					packages.push({
						version: package_json.dependencies[key].split(/#v?/)[1],
						help_link: `https://github.com/bitfocus/${key}/blob/${
							package_json.dependencies[key].split(/#/)[1]
						}/HELP.md`,
						help_url: `https://raw.githubusercontent.com/bitfocus/${key}/${
							package_json.dependencies[key].split(/#/)[1]
						}/HELP.md`,
						name: name,
						url: package_json.dependencies[key],
						api_version: sub_package_json.api_version,
						keywords: sub_package_json.keywords,
						manufacturer: sub_package_json.manufacturer,
						product: Array.isArray(sub_package_json.product) ? sub_package_json.product : [sub_package_json.product],
						shortname: sub_package_json.shortname,
						author: [sub_package_json.author],
					})
				}
			})
		}
	} else {
		console.log('[4] Skipping module-legacy')
	}

	if (!errors.length) {
		console.log('[6] Writing output')
		let output: CompanionModulesReport = {
			generated_at: new Date(),
			generated_by: 'companion-modules-generator @ ' + os.hostname(),
			modules: packages,
		}

		if (process.env.DEBUG_WRITE_TO_FILE) {
			fs.writeFileSync('test.json', JSON.stringify(output, undefined, 4))
			console.log('File written')
		} else {
			// Use axios to POST request output to https://api.bitfocus.io/v1/companion/modules
			await fetch('https://api.bitfocus.io/v1/webhooks/modules', {
				method: 'POST',
				body: JSON.stringify(output),
				headers: {
					'Content-Type': 'application/json',
					secret: process.env.MODULE_CRON_SECRET || 'missing cron secret',
				},
			})

			console.log('Data submitted')
		}
	} else {
		console.log('Failed')
		console.error('We have errors')
		console.error(errors)
		process.exit(1)
	}
}

main()
