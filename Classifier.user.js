// ==UserScript==
// @name         Classifier for BANC
// @namespace    KrzysztofKruk-BANC
// @version      0.5.4
// @description  Helps grouping cells of the same type
// @author       Krzysztof Kruk
// @match        https://spelunker.cave-explorer.org/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/ChrisRaven/BANC-Classifier/main/Classifier.user.js
// @downloadURL  https://raw.githubusercontent.com/ChrisRaven/BANC-Classifier/main/Classifier.user.js
// @homepageURL  https://github.com/ChrisRaven/BANC-Classifier
// ==/UserScript==

/* globals BigInt, globalThis, Dock */

if (!document.getElementById('dock-script')) {
  let script = document.createElement('script')
  script.id = 'dock-script'
  script.src = typeof DEV !== 'undefined' ? 'http://127.0.0.1:5501/BANC-Dock/Dock.js' : 'https://chrisraven.github.io/BANC-Dock/Dock.js'
  document.head.appendChild(script)
}
const DEV = true
const QUICK_COLLECT = DEV

let wait = setInterval(() => {
  if (globalThis.dockIsReady) {
    clearInterval(wait)
    main()
  }
}, 100)


let storage
let classified
let lastClassified = -1

const NO_OF_LABELS = 30
const defaultLabels = [
  'Centrifugal (C)',
  'Distal medulla (Dm)',
  'Lamina intrinsic (Lai)',
  'Lamina monopolar (L)',
  'Lamina wide field (Lawf)',
  'Lobula columnar (Lc)',
  'Lobula-lobula plate columnar (LLPC)',
  'Lobula plate-lobula columnar (LPLC)',
  'Lobula intrinsic (Li)',
  'Lobula plate intrinsic (Lpi)',
  'Lobula tangential (Lt)',
  'Medulla intrinsic (Mi)',
  'Medulla tangential (Mt)',
  'Optic lobe tangential (Olt)',
  'Proximal medulla (Pm)',
  'Retinula axon (R)',
  'T',
  'Translobula (Tl)',
  'Translobula-plate (Tlp)',
  'Transmedullary (Tm)',
  'Transmedullary Y (TmY)',
  'Y',
  'unknown',
  'other'
]

let currentLabels = defaultLabels
let classifyHighlighted = false
let useArrows = false
let deleteAfterClassification = false
let jumpToNextAfterDeletion = false


function fix_editableLabels_2022_11_17() {
  if (Dock.ls.get('fix_editableLabels_2022_11_17') === 'fixed') return

  storage.get('kk-classifier').then(res => {
    let saved = res['kk-classifier']

    if (!saved) {
      Dock.ls.set('fix_editableLabels_2022_11_17', 'fixed')
      return
    }

    let toBeSaved = {
      labels: defaultLabels,
      entries: []
    }

    for (const [key, value] of Object.entries(saved)) {
      let index = toBeSaved.labels.indexOf(key)
      toBeSaved.entries[index] = value
    }

    for (let i = 0; i < defaultLabels.length; i++) {
      if (!toBeSaved.entries[i]) {
        toBeSaved.entries[i] = []
      }
    }

    storage.set('kk-classifier', { value: toBeSaved }).then(() => {
      Dock.ls.set('fix_editableLabels_2022_11_17', 'fixed')
    })
  })
}


function main() {
  storage = window.Sifrr.Storage.getStorage('indexeddb')

  fix_editableLabels_2022_11_17()

  getEntries()

  let dock = new Dock()

  dock.addAddon({
    name: 'Classifier',
    id: 'kk-classifier',
    html: generateHtml()
  })

  function generateHtml() {
    return /*html*/`
      <label>
        <input type="checkbox" id="kk-classifier-element-selection">Classify highlighted segment
      </label><br />
      <label>
        <input type="checkbox" id="kk-classifier-use-arrows">Use arrows
      </label><br />
      <label>
        <input type="checkbox" id="kk-classifier-delete-after-classification">Delete after classification
      </label><br />
      <label>
        <input type="checkbox" id="kk-classifier-jump-to-next">Jump to next after deletion
      </label>
    `
  }

  classifyHighlighted = Dock.ls.get('classifier-element-selection-highlighted') === 'true'
  document.getElementById('kk-classifier-element-selection').checked = classifyHighlighted

  useArrows = Dock.ls.get('classifier-use-arrows') === 'true'
  document.getElementById('kk-classifier-use-arrows').checked = useArrows

  deleteAfterClassification = Dock.ls.get('classifier-delete-after-classification') === 'true'
  document.getElementById('kk-classifier-delete-after-classification').checked = deleteAfterClassification

  jumpToNextAfterDeletion = Dock.ls.get('classifier-jump-to-next') === 'true'
  document.getElementById('kk-classifier-jump-to-next').checked = jumpToNextAfterDeletion


  let id

  const topBar = document.getElementsByClassName('neuroglancer-viewer-top-row')[0]
  const button = document.createElement('button')
  button.id = 'kk-classifier-get-classified'
  button.innerHTML = 'Get<br />classified'
  button.addEventListener('click', getClassifiedCellsHandler)

  const undoButton = document.getElementById('neuroglancer-undo-button')
  topBar.insertBefore(button, undoButton)

  document.addEventListener('contextmenu', e => {
    if (!e.target.classList.contains('segment-color-selector')) return

    id = e.target.parentNode.parentNode.getElementsByClassName('segment-button')[0].dataset.segId

    let list = `<select id="classifier-list" multiple size=${NO_OF_LABELS}>`
    list += classified.labels.reduce((prev, current) => {
      return prev + '<option>' + current + '</option>'
    }, '')
    list += '</select>'

    Dock.dialog({
      id: 'classifier-select',
      destroyAfterClosing: true,
      okCallback: okCallback,
      html: list,
      width: 250,
      cancelCallback: () => {}
    }).show()
  })

  function okCallback() {
    const el = document.getElementById('classifier-list')
    const sel = el.options[el.selectedIndex].text

    addEntry(sel, id)
  }

  addCss()


  function uncheckAll() {
    document.querySelectorAll('.segment-div > .segment-checkbox').forEach(el => {
      if (el.checked) {
        el.click()
      }
    })
  }

  document.addEventListener('keyup', e => {
    if (document.activeElement) {
      const tagName = document.activeElement.tagName.toLowerCase()
      if (tagName === 'input' || tagName === 'textarea') return
    }

    let id = -1
    if (!classifyHighlighted) {
      id = document.querySelector('.neuroglancer-segment-list .neuroglancer-visible')
      //id = document.querySelector('.segment-div > .segment-checkbox:checked')
      if (id) {
        id = id.parentElement.parentElement.dataset.id
        //id = id.parentElement.getElementsByClassName('segment-button')[0].dataset.segId
      }
    }
    else {
      id = document.querySelector('.selected-segment-button > .segment-button')
      if (id) {
        id = id.dataset.segId
      }
    }

    let index = -1

    let ev, panel
    let current, next
    let element

    switch (e.key.toLowerCase()) {
      case 'q':
        if (e.ctrlKey) {
          if (lastClassified > -1) {
            const withdrawnId = classified.entries[lastClassified].pop()
            viewer.selectedLayer.layer_.layer_.displayState.segmentationGroupState.value.selectedSegments.add(BigInt(withdrawnId))
            viewer.selectedLayer.layer_.layer_.displayState.segmentationGroupState.value.visibleSegments.add(BigInt(withdrawnId))
            saveEntries()

            lastClassified = -1
          }
        }
        else {
          index = 0
        }

        break

      case 'w': index = 1; break

      case 'e':
        index = 2

        ev = new Event('action:rotate-relative-z-')
        panel = document.querySelector('.neuroglancer-rendered-data-panel button[title="Switch to 3d layout."]')

        if (!panel) {
          panel = document.querySelector('.neuroglancer-rendered-data-panel button[title="Switch to 4panel layout."]')
        }
        if (panel) {
          panel.parentElement.parentElement.dispatchEvent(ev)
        }

        break

      case 'r':
        index = 3

        ev = new Event('action:rotate-relative-z+')
        panel = document.querySelector('.neuroglancer-rendered-data-panel button[title="Switch to 3d layout."]')
        if (!panel) {
          panel = document.querySelector('.neuroglancer-rendered-data-panel button[title="Switch to 4panel layout."]')
        }
        if (panel) {
          panel.parentElement.parentElement.dispatchEvent(ev)
        }

        break

      case 't': index = 4; break

      case 'y': index = 5; break
/*
      case 'x':
        if (classifyHighlighted) {
          element = document.querySelector('.selected-segment-button input[type="checkbox"]')
        }
        else {
          element = document.querySelector('.segment-div > input[type="checkbox"]')
        }
        if (element) {
          element.click()
        }
        break
*/
      case 'd':
        if (classifyHighlighted) {
          element = document.querySelector('.neuroglancer-segment-list .neuroglancer-visible').parentElement.parentElement
          //element = document.querySelector('.selected-segment-button > .segment-button')
        }
        else {
          element = document.querySelector('.neuroglancer-segment-list .neuroglancer-visible').parentElement.parentElement
          //element = document.querySelector('.segment-div > .segment-checkbox:checked').parentElement.getElementsByClassName('segment-button')[0]
        }
        if (element) {
          next = element.nextSibling
          element.querySelector('.neuroglancer-segment-list-entry-star').click()
        }

      if (!jumpToNextAfterDeletion) {
        break
      }


      case 'capslock':
        if (!QUICK_COLLECT) return
      case 'arrowright':
        if (!useArrows) return

        //current = document.querySelector('.segment-div > .segment-checkbox:checked')
        //uncheckAll()
        if (jumpToNextAfterDeletion && next) {
          next.querySelector('.neuroglancer-eye-icon').click()
          //next.querySelector('.segment-checkbox').click()
        }
        /*else if (!current) {
          current = document.querySelector('.segment-div > .segment-checkbox')
          current.click() // check the first segment
          current.scrollIntoView()
        }
        else {
          next = current.parentElement.nextSibling

          if (next) {
            next.getElementsByClassName('segment-checkbox')[0].click()
            next.scrollIntoView()
          }
          else {
            current.click()
          }
        }*/

        break

      case 'arrowleft':
        if (!useArrows) return

        current = document.querySelector('.segment-div > .segment-checkbox:checked')
        uncheckAll()
        if (!current) {
          current = document.querySelector('.segment-div > .segment-checkbox')
          current.click() // check the first segment
          current.scrollIntoView()
        }
        else {
          let previous = current.parentElement.previousSibling

          if (previous && previous.id !== 'kk-utilities-action-menu') {
            previous.getElementsByClassName('segment-checkbox')[0].click()
            previous.scrollIntoView()
          }
          else {
            current.click()
          }
        }

        break
    }


    if (index > -1) {
      lastClassified = index
      addEntry(classified.labels[index], id)
    }

    if (!e.ctrlKey && ['q', 'w', 'e', 'r', 't', 'y', 'd'].includes(e.key.toLowerCase())) {
      if (deleteAfterClassification && e.key !== 'd') { // we don't want to delete all the segments one after another
        document.dispatchEvent(new KeyboardEvent('keyup', { key: 'd' }))
      }
    }
  })

  document.addEventListener('add-ids', e => {
    addEntries(e.detail.target, e.detail.ids, e.detail.callback)
  })

  document.addEventListener('remove-ids', e => {
    clearEntry(e.detail.target, e.detail.callback)
  })

  document.addEventListener('get-ids', e => {
    getEntries(e.detail.callback, e.detail.target)
  })

  document.getElementById('kk-classifier-element-selection').addEventListener('change', e => {
      Dock.ls.set('classifier-element-selection-highlighted', e.target.checked)
      classifyHighlighted = e.target.checked
  })

  document.getElementById('kk-classifier-use-arrows').addEventListener('change', e => {
    Dock.ls.set('classifier-use-arrows', e.target.checked)
    useArrows = e.target.checked
  })

  document.getElementById('kk-classifier-delete-after-classification').addEventListener('change', e => {
    Dock.ls.set('classifier-delete-after-classification', e.target.checked)
    deleteAfterClassification = e.target.checked
  })

  document.getElementById('kk-classifier-jump-to-next').addEventListener('change', e => {
    Dock.ls.set('classifier-jump-to-next', e.target.checked)
    jumpToNextAfterDeletion = e.target.checked
  })

  if (QUICK_COLLECT) {
    const LS_NAME = 'currentClassificationId'
    let clId = parseInt(localStorage.getItem(LS_NAME), 10)

    if (clId === null) {
      clId = 0
      localStorage.setItem(LS_NAME, clId)
    }

    Dock.setId = id => {
      clId = id
      localStorage.setItem(LS_NAME, id)
    }

    Dock.getId = () => console.log(clId)

    const button = document.createElement('button')
    button.id = 'current-classification-id'
    button.textContent = clId
    button.style.border = '1px solid white'
    button.style.padding = '0 10px'
    button.style.margin = '0 5px'

    const tools = document.getElementsByClassName('neuroglancer-annotation-tool-status')[0]
    tools.insertAdjacentElement('beforebegin', button)

    const MAX_INDEX = 4
    button.addEventListener('click', () => {
      clId = clId < MAX_INDEX ? clId + 1 : 0
      Dock.setId(clId)
      button.textContent = clId
    })

    button.addEventListener('contextmenu', e => {
      e.preventDefault()
      e.stopImmediatePropagation()
      clId = clId > 0 ? clId - 1 : MAX_INDEX
      Dock.setId(clId)
      button.textContent = clId
    })

    function quickCollectSegment() {
      try {
      const id = viewer.mouseState.pickedValue.toString()
      if (id && id !== '0') {
        viewer.selectedLayer.layer_.layer_.displayState.segmentationGroupState.value.selectedSegments.delete(BigInt(id))
        lastClassified = clId
        addEntry(classified.labels[clId], id)
        // source: https://stackoverflow.com/a/29289196
        /*const xpath=`//div[text()='${id}'][@class='neuroglancer-segment-list-entry-id']`
        const element = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
        if (element) {
          addEntry(classified.labels[clId], id)
          element.parentElement.nextSibling.click()
        }*/
      }
      }
        catch (e) {
          console.log(e)
        }
    }

    document.body.addEventListener('mousedown', e => {
      if (e.buttons === 4) {
        quickCollectSegment()
      }
    })

    document.body.addEventListener('keydown', e => {
      if (e.key === 'x' || e.key === 'X') {
        quickCollectSegment()
      }
    })

    document.body.addEventListener('click', e => {
      if (e.ctrlKey && e.altKey) {
        quickCollectSegment()
      }

      if (QUICK_COLLECT) {
        if (e.ctrlKey && e.shiftKey) {
          const id = viewer.mouseState.pickedValue.toJSON()
          if (id) {
            const element = document.querySelector(`button[data-seg-id="${id}"]`)
            if (element) {
              element.click()
            }
          }
        }
      }
    })
  }

}


function saveEntries(callback) {
  storage.set('kk-classifier', { value: classified }).then(() => {
    if (callback) {
      callback()
    }
  })
}


function getIndex(label) {
  return classified.labels.indexOf(label)
}


function addEntry(label, id, callback) {
  const index = getIndex(label)
  if (index > -1) {
    if (!classified.entries[index]) {
      classified.entries[index] = []
    }
    classified.entries[index].push(id)
    saveEntries(callback)
  }
}

function addEntries(label, ids, callback) {
  const maxSizeOfBatch = 10000
  const index = getIndex(label)

  if (index > -1) {
    if (!classified.entries[index]) {
      classified.entries[index] = []
    }

    let batch = []
    while (ids.length > maxSizeOfBatch) {
      batch = ids.splice(0, maxSizeOfBatch)
      classified.entries[index].push(...batch)
    }
    classified.entries[index].push(...ids)

    saveEntries(callback)
  }
}


function clearEntry(label, callback) {
  classified.labels.forEach((el, i) => {
    if (el === label) {
      classified.entries[i] = []
    }
  })
  saveEntries(callback)
}

function getEntries(callback, target) {
  storage.get('kk-classifier').then(res => {
    classified = res['kk-classifier']
    if (!classified) {
      classified = {
        labels: defaultLabels,
        entries: []
      }
    }
    if (callback) {
      const id = classified.labels.indexOf(target)
      callback(classified.entries[id])
    }
  })
}


function getClassifiedCellsHandler() {
  const labels = classified.labels
  const entries = classified.entries

  let html = '<button id="kk-classifier-copy-all">Copy All</button>'
  html += '<button id="kk-classifier-edit-labels">Edit Labels</button>'
  html += '<table id="kk-classifier-table">'
  for (let i = 0; i < NO_OF_LABELS; i++) {
    let label = labels[i]
    let entry = entries[i]

    html += `
      <tr data-label="${label || ''}">
        <td class="kk-classifier-labels">${label || ''}</td>
        <td class="kk-classifier-ids">${Array.isArray(entry) ? entry.join(', ') : ''}</td>
        <td class="kk-classifier-buttons">
          <button class="kk-classifier-copy">Copy</button>
          <button class="kk-classifier-remove">Remove</button>
        </td>
      </tr>
    `
  }
  html += '</table>'

  const afterCreateCallback = () => {
    document.getElementById('kk-classifier-table').addEventListener('click', e => {
      if (e.target.classList.contains('kk-classifier-copy')) {
        const ids = e.target.parentNode.previousElementSibling.textContent.trim()
        navigator.clipboard.writeText(ids)
      }
      else if (e.target.classList.contains('kk-classifier-remove')) {
        Dock.dialog({
          id: 'kk-classifier-remove-confirmation',
          html: 'Do you want to remove all these entries?',
          okCallback: () => {
            const label = e.target.parentNode.parentNode.dataset.label
            clearEntry(label)
            e.target.parentNode.previousElementSibling.textContent = ''
          },
          okLabel: 'Confirm',
          cancelCallback: () => {},
          cancelLabel: 'Cancel',
          destroyAfterClosing: true
        }).show()

      }
    })

    document.getElementById('kk-classifier-copy-all').addEventListener('click', e => {
      let str = ''
      let label, entries
      for (let i = 0; i < classified.labels.length; i++) {
        label = classified.labels[i]
        entries = classified.entries[i]
        if (label && entries && entries.length) {
          str += label + '\r\n' + entries.join(', ') + '\r\n\r\n'
        }
      }
      navigator.clipboard.writeText(str)
    })

    document.getElementById('kk-classifier-edit-labels').addEventListener('click', editLabelsHandler)
  }

  Dock.dialog({
    id: 'kk-classifier-show-entries',
    html: html,
    okCallback: () => {},
    afterCreateCallback: afterCreateCallback,
    destroyAfterClosing: true,
    width: 840
  }).show()
}


function editLabelsHandler() {
  const labels = classified.labels
  let html = '<button id="kk-classifier-restore-default-labels" title="Restore labels to types existing in the optic lobe">Restore default labels</button>';
  for (let i = 0; i < NO_OF_LABELS; i++) {
    html += `<input class="kk-classifier-label-name" value="${labels[i] || ''}"><br />`
  }

  Dock.dialog({
    id: 'kk-classifier-edit-labels-dialog',
    html: html,
    width: 310,
    destroyAfterClosing: true,
    afterCreateCallback: afterCreateCallback,
    okCallback: okCallback,
    cancelCallback: () => {}
  }).show()

  function afterCreateCallback() {
    document.getElementById('kk-classifier-restore-default-labels').addEventListener('click', () => {
      const inputs = document.getElementsByClassName('kk-classifier-label-name')
      const labels = document.getElementsByClassName('kk-classifier-labels')
      for (let i = 0; i < NO_OF_LABELS; i++) {
        inputs[i].value = defaultLabels[i] || ''
      }
    })
  }

  function okCallback() {
    let labels = []
    const tableRows = document.querySelectorAll('#kk-classifier-table tr')
    document.querySelectorAll('.kk-classifier-label-name').forEach((el, index) => {
      labels.push(el.value)
      tableRows[index].firstElementChild.textContent = el.value
    })
    classified.labels = labels
    saveEntries()
  }
}


function addCss() {
  Dock.addCss(/*css*/`
    #classifier-list {
      overflow: hidden;
      background-color: #222;
      color: white;
      padding: 15px;
    }

    #kk-classifier-show-entries > div.content {
      height: 80vh;
      overflow: auto;
    }

    .content button#kk-classifier-edit-labels {
      width: 100px;
    }

    .kk-classifier-ids {
      font-size: 12px;
    }

    #kk-classifier-table {
      padding: 10px;
    }

    #kk-classifier-table td {
      padding: 5px;
    }

    #kk-classifier-table tr:nth-child(even) {
      background-color: #333;
    }

    .kk-classifier-buttons {
      min-width: 160px;
    }

    .kk-classifier-label-name {
      width: 300px;
      padding: 2px;
      margin: 1px;
    }

    .content #kk-classifier-restore-default-labels {
      width: 150px;
      margin-bottom: 10px;
    }

    #kk-classifier-get-classified {
      font-size: 14px;
    }
  `)
}
