// function generateRandomString() {
//     const length = Math.floor(Math.random() * 11) + 20;
//     const characters = 'abcdefghijklmnopqrstuvwxyz';
//     let result = '';
//     for (let i = 0; i < length; i++) {
//         result += characters.charAt(Math.floor(Math.random() * characters.length));
//     }
//     return result;
// }

// const classes = new Proxy({}, {
//     get(target, prop) {
//         if (!(prop in target)) {
//             target[prop] = generateRandomString();
//         }
//         return target[prop];
//     }
// });

// const STATUS_BLOCK_ELEMENT_ID = generateRandomString();

// class SendCvError extends Error {

//     details;

//     constructor(message, details) {
//         super(message);
//         this.name = 'SendCvError';
//         this.details = details;
//     }

//     get details() {
//         return this.details;
//     }

// }

// class SendCvUserError extends SendCvError {
//     constructor(message) {
//         super(message);
//         this.name = 'SendCvUserError';
//     }
// }

// class SendCvSkipError extends SendCvError {
//     constructor(message) {
//         super(message);
//         this.name = 'SendCvSkipError';
//     }
// }

// class SearchError extends Error {

//     details;

//     constructor(message, details) {
//         super(message);
//         this.name = 'SearchError';
//         this.details = details;
//     }

//     get details() {
//         return this.details;
//     }

// }

// class NotAuthorizedError extends Error {
//     constructor(message) {
//         super(message);
//         this.name = 'NotAuthorizedError';
//     }
// }

// function normalizeUrl(link) {
//     const url = new URL(link);
//     return url.origin + url.pathname;
// }

// function scrollToTargetAdjusted(element, offset) {
//     const bodyRect = document.body.getBoundingClientRect().top;
//     const elementRect = element.getBoundingClientRect().top;
//     const elementPosition = elementRect - bodyRect;
//     const offsetPosition = elementPosition - offset;
//     window.scrollTo({
//         top: offsetPosition,
//         behavior: "smooth"
//     });
// }

// function scrollToAndSetValue(element, value) {
//     element?.scrollIntoView();
//     element.value = value;
// }

// function scrollToAndSetValueSilent(element, value) {
//     try {
//         element?.scrollIntoView();
//         element.value = value;
//     } catch (e) {
//     }
// }

// function dispatchInputEvent(element) {
//     element.dispatchEvent(new Event('input', { bubbles: true }));
// }

// function setNativeValue(element, value) {

//     const ownPropertyDescriptor = Object.getOwnPropertyDescriptor(element, 'value');

//     if (!ownPropertyDescriptor) {
//         element.value = value;
//         dispatchInputEvent(element);
//         return;
//     }

//     const valueSetter = ownPropertyDescriptor.set;
//     const prototype = Object.getPrototypeOf(element);
//     const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;

//     if (valueSetter && valueSetter !== prototypeValueSetter) {
//         prototypeValueSetter.call(element, value);
//     } else {
//         valueSetter.call(element, value);
//     }

//     dispatchInputEvent(element);

// }

// async function uploadFile(url, fileName, input) {

//     if (!url || !fileName || !input) {
//         throw new SendCvError('url or fileName or input not found');
//     }

//     const blob = await fetch(url, { method: 'GET' }).then(res => res.blob());

//     const dataTransfer = new DataTransfer();
//     dataTransfer.items.add(new File([blob], fileName, { type: blob.type, lastModified: new Date() }));

//     input.files = dataTransfer.files;
//     input.dispatchEvent(new Event('change', { bubbles: true }));

// }

// async function parseCountriesAndCities(rawValue) {
//     return await new Promise((resolve, reject) => {
//         chrome.runtime.sendMessage({
//             type: "GET-VACANCY-COUNTRIES-CITIES",
//             data: rawValue,
//         }).then(async ({ type, data }) => {
//             if (type !== 'SUCCESS') {
//                 reject(data);
//                 return;
//             }
//             resolve(data);
//         }).catch(reason => {
//             reject(reason);
//         });
//     });
// }

// function wait(timeout) {
//     return new Promise(resolve => {
//         setTimeout(() => {
//             resolve();
//         }, timeout);
//     });
// }

// function waitAnd(timeout, andFn) {
//     return new Promise(resolve => {
//         setTimeout(() => {
//             try {
//                 if (typeof andFn === 'function') {
//                     andFn();
//                 }
//             } catch (e) {
//                 console.error(e)
//             }
//             resolve();
//         }, timeout);
//     });
// }

// function errorToString(e) {
//     if (e instanceof Error) {
//         if (e.stack) {
//             return e.stack.replace(/chrome-extension\:\/\/\w+/g, '');
//         }
//         let obj = {};
//         Error.captureStackTrace(obj, errorToString)
//         return obj.stack.replace(/chrome-extension\:\/\/\w+/g, '');
//     }
//     return e?.toString() ?? 'Unknown error: ' + e;
// }

// function disableApplyOneModal() {
//     closeAgent();

//     modalOverlay = document.createElement('div');
//     modalOverlay.style.position = 'fixed';
//     modalOverlay.style.display = 'flex';
//     modalOverlay.style.alignItems = 'center';
//     modalOverlay.style.justifyContent = 'center';
//     modalOverlay.style.top = 0;
//     modalOverlay.style.left = 0;
//     modalOverlay.style.right = 0;
//     modalOverlay.style.bottom = 0;
//     modalOverlay.style.margin = 0;
//     modalOverlay.style.padding = 0;
//     modalOverlay.style.zIndex = '999999';
//     modalOverlay.style.background = 'rgba(0, 0, 0, .6)';
    
//     modalWindow = document.createElement('div');
//     modalWindow.style.backgroundColor = '#fcfaff';
//     modalWindow.style.borderRadius = '12px';
//     modalWindow.style.margin = 0;
//     modalWindow.style.padding = '32px';
//     modalWindow.style.paddingBottom = '52px';
//     modalWindow.style.marginBottom = '18vh';
//     modalOverlay.append(modalWindow);

//     modalHeader = document.createElement('div');
//     modalHeader.style.margin = 0;
//     modalHeader.style.display = 'flex';
//     modalHeader.style.padding = 0;

//     modalWindow.append(modalHeader);

//     modalTitle = document.createElement('div');
//     modalTitle.innerText = 'Disable AI agent autorun? 🚫';
//     modalTitle.style.font = 'normal 600 24px Arial';
//     modalTitle.style.color = '#0a102f';
//     modalTitle.style.textAlign = 'left';
//     modalTitle.style.margin = 0;
//     modalTitle.style.display = 'block';
//     modalTitle.style.padding = 0;
//     modalTitle.style.marginBottom = '26px';
//     modalHeader.append(modalTitle);

//     modalIcon = document.createElement('div');
//     modalIcon.style.margin = 0;
//     modalIcon.style.display = 'block';
//     modalIcon.style.padding = 0;
//     modalIcon.style.flexGrow = '1';
//     modalHeader.append(modalIcon);

//     modalCloseBtn = document.createElement('img');
//     modalCloseBtn.src = 'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2015%2015%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20style%3D%22width%3A%20var(--cb-icon-size%2C%2070%25)%3B%20height%3A%20var(--cb-icon-size%2C%2070%25)%3B%22%3E%3Cpath%20d%3D%22M11.7816%204.03157C12.0062%203.80702%2012.0062%203.44295%2011.7816%203.2184C11.5571%202.99385%2011.193%202.99385%2010.9685%203.2184L7.50005%206.68682L4.03164%203.2184C3.80708%202.99385%203.44301%202.99385%203.21846%203.2184C2.99391%203.44295%202.99391%203.80702%203.21846%204.03157L6.68688%207.49999L3.21846%2010.9684C2.99391%2011.193%202.99391%2011.557%203.21846%2011.7816C3.44301%2012.0061%203.80708%2012.0061%204.03164%2011.7816L7.50005%208.31316L10.9685%2011.7816C11.193%2012.0061%2011.5571%2012.0061%2011.7816%2011.7816C12.0062%2011.557%2012.0062%2011.193%2011.7816%2010.9684L8.31322%207.49999L11.7816%204.03157Z%22%20fill%3D%22currentColor%22%20fill-rule%3D%22evenodd%22%20clip-rule%3D%22evenodd%22%3E%3C%2Fpath%3E%3C%2Fsvg%3E';
//     modalCloseBtn.style.margin = 0;
//     modalCloseBtn.style.display = 'block';
//     modalCloseBtn.style.padding = 0;
//     modalCloseBtn.style.height = '20px';
//     modalCloseBtn.style.cursor = 'pointer';
//     modalHeader.append(modalCloseBtn);

//     modalContent = document.createElement('div');
//     modalContent.innerText = "We noticed you’ve closed the AI agent popup.\nShould we stop launching it automatically?\nYou can re-enable it anytime in the Chrome Extension settings.";
//     modalContent.style.font = 'normal 400 18px Arial';
//     modalContent.style.color = '#0a102f';
//     modalContent.style.margin = 0;
//     modalContent.style.display = 'block';
//     modalContent.style.padding = 0;
//     modalContent.style.lineHeight = '1.3';
//     modalContent.style.marginBottom = '50px';
//     modalWindow.append(modalContent);

//     modalButton = document.createElement('div');
//     modalButton.innerText = "Confirm";
//     modalButton.style.font = 'normal 700 16px Arial';
//     modalButton.style.color = '#ffffff';
//     modalButton.style.margin = 0;
//     modalButton.style.display = 'inline';
//     modalButton.style.padding = '15px 85px';
//     modalButton.style.borderRadius = '5px';
//     modalButton.style.textAlign = 'center';
//     modalButton.style.backgroundColor = '#a259ff';
//     modalButton.style.border = '2px solid #a259ff';
//     modalButton.style.cursor = 'pointer';
//     modalWindow.append(modalButton);

//     modalButton.addEventListener('mouseenter', () => {
//         modalButton.style.backgroundColor = '#ffffff';
//         modalButton.style.color = '#0A102F';
//       });
      
//     modalButton.addEventListener('mouseleave', () => {
//         modalButton.style.backgroundColor = '#a259ff';
//         modalButton.style.color = '#ffffff';
//     });

//     modalCloseBtn.addEventListener('click', () => {
//         modalOverlay.remove();
//     });

//     modalButton.addEventListener('click', () => {
//         modalOverlay.remove();
//         chrome.runtime.sendMessage({type: 'DISABLE-APPLY-ONE'});
//     });
    
//     document.body.append(modalOverlay);

// }

// function showCloseModal() {
    
//     modalOverlay = document.createElement('div');
//     modalOverlay.style.position = 'fixed';
//     modalOverlay.style.display = 'flex';
//     modalOverlay.style.alignItems = 'center';
//     modalOverlay.style.justifyContent = 'center';
//     modalOverlay.style.top = 0;
//     modalOverlay.style.left = 0;
//     modalOverlay.style.right = 0;
//     modalOverlay.style.bottom = 0;
//     modalOverlay.style.margin = 0;
//     modalOverlay.style.padding = 0;
//     modalOverlay.style.zIndex = '999999';
//     modalOverlay.style.background = 'rgba(0, 0, 0, .6)';
    
//     modalWindow = document.createElement('div');
//     modalWindow.style.backgroundColor = '#fcfaff';
//     modalWindow.style.borderRadius = '12px';
//     modalWindow.style.margin = 0;
//     modalWindow.style.padding = '32px';
//     modalWindow.style.paddingBottom = '52px';
//     modalWindow.style.marginBottom = '18vh';
//     modalOverlay.append(modalWindow);

//     modalHeader = document.createElement('div');
//     modalHeader.style.margin = 0;
//     modalHeader.style.display = 'flex';
//     modalHeader.style.padding = 0;

//     modalWindow.append(modalHeader);

//     modalTitle = document.createElement('div');
//     modalTitle.innerText = 'End session?';
//     modalTitle.style.font = 'normal 600 24px Arial';
//     modalTitle.style.color = '#0a102f';
//     modalTitle.style.textAlign = 'left';
//     modalTitle.style.margin = 0;
//     modalTitle.style.display = 'block';
//     modalTitle.style.padding = 0;
//     modalTitle.style.marginBottom = '26px';
//     modalHeader.append(modalTitle);

//     modalIcon = document.createElement('img');
//     modalIcon.src = 'data:image/svg+xml,%3Csvg%20%20%20xmlns%3Adc%3D%22http%3A%2F%2Fpurl.org%2Fdc%2Felements%2F1.1%2F%22%20%20%20xmlns%3Acc%3D%22http%3A%2F%2Fcreativecommons.org%2Fns%23%22%20%20%20xmlns%3Ardf%3D%22http%3A%2F%2Fwww.w3.org%2F1999%2F02%2F22-rdf-syntax-ns%23%22%20%20%20xmlns%3Asvg%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20%20%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20%20%20version%3D%221.1%22%20%20%20width%3D%22156.262%22%20%20%20id%3D%22svg1609%22%20%20%20height%3D%22144.407%22%3E%3Ctitle%20%20%20%20%20id%3D%22title4599%22%3EWarning%20sign%3C%2Ftitle%3E%3Cmetadata%20%20%20%20%20id%3D%22metadata2%22%3E%3Crdf%3ARDF%3E%3Ccc%3AWork%20%20%20%20%20%20%20%20%20rdf%3Aabout%3D%22%22%3E%3Cdc%3Atitle%3EWarning%20sign%3C%2Fdc%3Atitle%3E%3Cdc%3Adescription%20%2F%3E%3Cdc%3Asubject%3E%3Crdf%3ABag%3E%3Crdf%3Ali%20%2F%3E%3Crdf%3Ali%3Ecaution%3C%2Frdf%3Ali%3E%3Crdf%3Ali%3Esecurity%3C%2Frdf%3Ali%3E%3Crdf%3Ali%3Ewarning%3C%2Frdf%3Ali%3E%3Crdf%3Ali%3Esigns_and_symbols%3C%2Frdf%3Ali%3E%3Crdf%3Ali%3Esign%3C%2Frdf%3Ali%3E%3C%2Frdf%3ABag%3E%3C%2Fdc%3Asubject%3E%3Cdc%3Apublisher%3E%3Ccc%3AAgent%20%20%20%20%20%20%20%20%20%20%20%20%20rdf%3Aabout%3D%22http%3A%2F%2Fwww.openclipart.org%22%3E%3Cdc%3Atitle%3EThomas%20Weller%3C%2Fdc%3Atitle%3E%3C%2Fcc%3AAgent%3E%3C%2Fdc%3Apublisher%3E%3Cdc%3Acreator%3E%3Ccc%3AAgent%3E%3Cdc%3Atitle%3EThomas%20Weller%3C%2Fdc%3Atitle%3E%3C%2Fcc%3AAgent%3E%3C%2Fdc%3Acreator%3E%3Cdc%3Arights%3E%3Ccc%3AAgent%3E%3Cdc%3Atitle%3EThomas%20Weller%3C%2Fdc%3Atitle%3E%3C%2Fcc%3AAgent%3E%3C%2Fdc%3Arights%3E%3Cdc%3Adate%20%2F%3E%3Cdc%3Aformat%3Eimage%2Fsvg%2Bxml%3C%2Fdc%3Aformat%3E%3Cdc%3Atype%20%20%20%20%20%20%20%20%20%20%20rdf%3Aresource%3D%22http%3A%2F%2Fpurl.org%2Fdc%2Fdcmitype%2FStillImage%22%20%2F%3E%3Ccc%3Alicense%20%20%20%20%20%20%20%20%20%20%20rdf%3Aresource%3D%22http%3A%2F%2Fweb.resource.org%2Fcc%2FPublicDomain%22%20%2F%3E%3Cdc%3Alanguage%3Een%3C%2Fdc%3Alanguage%3E%3C%2Fcc%3AWork%3E%3Ccc%3ALicense%20%20%20%20%20%20%20%20%20rdf%3Aabout%3D%22http%3A%2F%2Fweb.resource.org%2Fcc%2FPublicDomain%22%3E%3Ccc%3Apermits%20%20%20%20%20%20%20%20%20%20%20rdf%3Aresource%3D%22http%3A%2F%2Fweb.resource.org%2Fcc%2FReproduction%22%20%2F%3E%3Ccc%3Apermits%20%20%20%20%20%20%20%20%20%20%20rdf%3Aresource%3D%22http%3A%2F%2Fweb.resource.org%2Fcc%2FDistribution%22%20%2F%3E%3Ccc%3Apermits%20%20%20%20%20%20%20%20%20%20%20rdf%3Aresource%3D%22http%3A%2F%2Fweb.resource.org%2Fcc%2FDerivativeWorks%22%20%2F%3E%3C%2Fcc%3ALicense%3E%3C%2Frdf%3ARDF%3E%3C%2Fmetadata%3E%3Cdefs%20%20%20%20%20id%3D%22defs1610%22%3E%3Cmarker%20%20%20%20%20%20%20viewBox%3D%220%200%2010%2010%22%20%20%20%20%20%20%20refY%3D%225%22%20%20%20%20%20%20%20refX%3D%220%22%20%20%20%20%20%20%20orient%3D%22auto%22%20%20%20%20%20%20%20markerWidth%3D%224%22%20%20%20%20%20%20%20markerUnits%3D%22strokeWidth%22%20%20%20%20%20%20%20markerHeight%3D%223%22%20%20%20%20%20%20%20id%3D%22ArrowEnd%22%3E%3Cpath%20%20%20%20%20%20%20%20%20id%3D%22path1612%22%20%20%20%20%20%20%20%20%20d%3D%22M%200%200%20L%2010%205%20L%200%2010%20z%22%20%2F%3E%3C%2Fmarker%3E%3Cmarker%20%20%20%20%20%20%20viewBox%3D%220%200%2010%2010%22%20%20%20%20%20%20%20refY%3D%225%22%20%20%20%20%20%20%20refX%3D%2210%22%20%20%20%20%20%20%20orient%3D%22auto%22%20%20%20%20%20%20%20markerWidth%3D%224%22%20%20%20%20%20%20%20markerUnits%3D%22strokeWidth%22%20%20%20%20%20%20%20markerHeight%3D%223%22%20%20%20%20%20%20%20id%3D%22ArrowStart%22%3E%3Cpath%20%20%20%20%20%20%20%20%20id%3D%22path1614%22%20%20%20%20%20%20%20%20%20d%3D%22M%2010%200%20L%200%205%20L%2010%2010%20z%22%20%2F%3E%3C%2Fmarker%3E%3C%2Fdefs%3E%3Cg%20%20%20%20%20transform%3D%22matrix(0.99073487%2C0%2C0%2C0.99073487%2C186.61494%2C2.4370252)%22%20%20%20%20%20id%3D%22g4593%22%3E%3Cpath%20%20%20%20%20%20%20id%3D%22path4595%22%20%20%20%20%20%20%20d%3D%22m%20-109.16602%2C7.2265625%20c%20-0.13666%2C0.0017%20-0.27279%2C0.017412%20-0.40625%2C0.046875%20-3.19494%2C0.029452%20-6.17603%2C1.6944891%20-7.78515%2C4.4824215%20l%20-31.25%2C54.126953%20-31.25%2C54.126958%20h%200.002%20c%20-3.41988%2C5.92217%201.01692%2C13.60908%207.85547%2C13.60937%20h%2062.5%2062.501953%20c%206.838552%2C-3.2e-4%2011.277321%2C-7.68721%207.857422%2C-13.60937%20l%20-31.25%2C-54.126958%20-31.251955%2C-54.126953%20c%20-1.46518%2C-2.5386342%20-4.07917%2C-4.1634136%20-6.97851%2C-4.4492184%20-0.14501%2C-0.042788%20-0.2944%2C-0.068998%20-0.44532%2C-0.078125%20h%20-0.004%20c%20-0.0312%2C-0.00138%20-0.0625%2C-0.00203%20-0.0937%2C-0.00195%20z%22%20%20%20%20%20%20%20style%3D%22color%3A%23000000%3Bopacity%3A1%3Bsolid-color%3A%23000000%3Bfill%3A%23000000%3Bfill-opacity%3A1%3Bstroke%3Anone%3B%22%20%2F%3E%3Cpath%20%20%20%20%20%20%20style%3D%22color%3A%23000000%3Bopacity%3A1%3Bsolid-color%3A%23000000%3Bfill%3A%23ffffff%3Bfill-opacity%3A1%3Bstroke%3Anone%3B%22%20%20%20%20%20%20%20d%3D%22m%20-109.16545%2C9.2265625%20c%20-2.63992%2C-0.1247523%20-5.13786%2C1.2403375%20-6.45899%2C3.5292965%20l%20-31.25%2C54.126953%20-31.25%2C54.126958%20c%20-2.67464%2C4.63164%200.77657%2C10.60914%206.125%2C10.60937%20h%2062.5%2062.50196%20c%205.34844%2C-2.5e-4%208.79965%2C-5.97774%206.125%2C-10.60937%20l%20-31.25%2C-54.126958%20-31.25196%2C-54.126953%20c%20-1.20213%2C-2.082863%20-3.38689%2C-3.4150037%20-5.78906%2C-3.5292965%20h%20-0.002%20z%22%20%20%20%20%20%20%20id%3D%22path4583%22%20%2F%3E%3Cpath%20%20%20%20%20%20%20style%3D%22color%3A%23000000%3Bopacity%3A1%3Bsolid-color%3A%23000000%3Bfill%3A%23000000%3Bfill-opacity%3A1%3Bstroke%3Anone%3B%22%20%20%20%20%20%20%20d%3D%22m%20-109.25919%2C11.224609%20c%20-1.89626%2C-0.08961%20-3.68385%2C0.887082%20-4.63282%2C2.53125%20l%20-31.25%2C54.126953%20-31.25%2C54.126958%20c%20-1.95283%2C3.38168%200.48755%2C7.6092%204.39258%2C7.60937%20h%2062.5%2062.50196%20c%203.905026%2C-1.8e-4%206.345394%2C-4.2277%204.39257%2C-7.60937%20l%20-31.25%2C-54.126958%20-31.25195%2C-54.126953%20c%20-0.86311%2C-1.495461%20-2.42763%2C-2.44919%20-4.15234%2C-2.53125%20z%22%20%20%20%20%20%20%20id%3D%22path4577%22%20%2F%3E%3Cpath%20%20%20%20%20%20%20style%3D%22opacity%3A1%3Bfill%3A%23ffcc00%3Bfill-opacity%3A1%3Bstroke%3Anone%3B%22%20%20%20%20%20%20%20id%3D%22path4573%22%20%20%20%20%20%20%20d%3D%22m%20-46.997381%2C124.54655%20-62.501079%2C0%20-62.50108%2C0%2031.25054%2C-54.127524%2031.25054%2C-54.127522%2031.25054%2C54.127521%20z%22%20%2F%3E%3Cg%20%20%20%20%20%20%20id%3D%22g858%22%20%20%20%20%20%20%20transform%3D%22translate(-188.06236)%22%3E%3Ccircle%20%20%20%20%20%20%20%20%20r%3D%228.8173475%22%20%20%20%20%20%20%20%20%20cy%3D%22111.11701%22%20%20%20%20%20%20%20%20%20cx%3D%2278.564362%22%20%20%20%20%20%20%20%20%20id%3D%22path846%22%20%20%20%20%20%20%20%20%20style%3D%22opacity%3A1%3Bfill%3A%23000000%3Bfill-opacity%3A1%3Bstroke%3Anone%3B%22%20%2F%3E%3Cpath%20%20%20%20%20%20%20%20%20id%3D%22circle848%22%20%20%20%20%20%20%20%20%20d%3D%22m%2078.564453%2C42.955078%20c%20-4.869714%2C-5.59e-4%20-8.817839%2C3.946692%20-8.818359%2C8.816406%203.15625%2C37.460938%200%2C0%203.15625%2C37.460938%208.93e-4%2C3.126411%202.535698%2C5.660342%205.662109%2C5.660156%203.126411%2C1.86e-4%205.661216%2C-2.533745%205.662109%2C-5.660156%203.154297%2C-37.460938%200%2C0%203.154297%2C-37.460938%20-5.2e-4%2C-4.868951%20-3.947455%2C-8.815886%20-8.816406%2C-8.816406%20z%22%20%20%20%20%20%20%20%20%20style%3D%22opacity%3A1%3Bfill%3A%23000000%3Bfill-opacity%3A1%3Bstroke%3Anone%3B%22%20%2F%3E%3C%2Fg%3E%3C%2Fg%3E%3C%2Fsvg%3E';
//     modalIcon.style.margin = 0;
//     modalIcon.style.marginLeft = '5px';
//     modalIcon.style.display = 'block';
//     modalIcon.style.padding = 0;
//     modalIcon.style.height = '26px';
//     modalHeader.append(modalIcon);

//     modalIcon = document.createElement('div');
//     modalIcon.style.margin = 0;
//     modalIcon.style.display = 'block';
//     modalIcon.style.padding = 0;
//     modalIcon.style.flexGrow = '1';
//     modalHeader.append(modalIcon);

//     modalCloseBtn = document.createElement('img');
//     modalCloseBtn.src = 'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2015%2015%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20style%3D%22width%3A%20var(--cb-icon-size%2C%2070%25)%3B%20height%3A%20var(--cb-icon-size%2C%2070%25)%3B%22%3E%3Cpath%20d%3D%22M11.7816%204.03157C12.0062%203.80702%2012.0062%203.44295%2011.7816%203.2184C11.5571%202.99385%2011.193%202.99385%2010.9685%203.2184L7.50005%206.68682L4.03164%203.2184C3.80708%202.99385%203.44301%202.99385%203.21846%203.2184C2.99391%203.44295%202.99391%203.80702%203.21846%204.03157L6.68688%207.49999L3.21846%2010.9684C2.99391%2011.193%202.99391%2011.557%203.21846%2011.7816C3.44301%2012.0061%203.80708%2012.0061%204.03164%2011.7816L7.50005%208.31316L10.9685%2011.7816C11.193%2012.0061%2011.5571%2012.0061%2011.7816%2011.7816C12.0062%2011.557%2012.0062%2011.193%2011.7816%2010.9684L8.31322%207.49999L11.7816%204.03157Z%22%20fill%3D%22currentColor%22%20fill-rule%3D%22evenodd%22%20clip-rule%3D%22evenodd%22%3E%3C%2Fpath%3E%3C%2Fsvg%3E';
//     modalCloseBtn.style.margin = 0;
//     modalCloseBtn.style.display = 'block';
//     modalCloseBtn.style.padding = 0;
//     modalCloseBtn.style.height = '20px';
//     modalCloseBtn.style.cursor = 'pointer';
//     modalHeader.append(modalCloseBtn);

//     modalContent = document.createElement('div');
//     modalContent.innerText = "You're about to close the AI agent. This action can't be undone.\n Next time, the AI agent will restart the job search from the beginning.";
//     modalContent.style.font = 'normal 400 18px Arial';
//     modalContent.style.color = '#0a102f';
//     modalContent.style.margin = 0;
//     modalContent.style.display = 'block';
//     modalContent.style.padding = 0;
//     modalContent.style.lineHeight = '1.3';
//     modalContent.style.marginBottom = '50px';
//     modalWindow.append(modalContent);

//     modalButton = document.createElement('div');
//     modalButton.innerText = "Stop agent";
//     modalButton.style.font = 'normal 700 16px Arial';
//     modalButton.style.color = '#ffffff';
//     modalButton.style.margin = 0;
//     modalButton.style.display = 'inline';
//     modalButton.style.padding = '15px 85px';
//     modalButton.style.borderRadius = '5px';
//     modalButton.style.textAlign = 'center';
//     modalButton.style.backgroundColor = '#a259ff';
//     modalButton.style.border = '2px solid #a259ff';
//     modalButton.style.cursor = 'pointer';
//     modalWindow.append(modalButton);

//     modalButton.addEventListener('mouseenter', () => {
//         modalButton.style.backgroundColor = '#ffffff';
//         modalButton.style.color = '#0A102F';
//       });
      
//     modalButton.addEventListener('mouseleave', () => {
//         modalButton.style.backgroundColor = '#a259ff';
//         modalButton.style.color = '#ffffff';
//     });

//     modalCloseBtn.addEventListener('click', () => {
//         modalOverlay.remove();
//     });

//     modalButton.addEventListener('click', () => {
//         modalWindow.remove();
//         chrome.runtime.sendMessage({type: 'STOP-APPLYING'});
//     });
    
//     document.body.append(modalOverlay);

// }

// function searchPageLeaved(f) {
    
//     modalOverlay = document.createElement('div');
//     modalOverlay.style.position = 'fixed';
//     modalOverlay.style.display = 'flex';
//     modalOverlay.style.alignItems = 'center';
//     modalOverlay.style.justifyContent = 'center';
//     modalOverlay.style.top = 0;
//     modalOverlay.style.left = 0;
//     modalOverlay.style.right = 0;
//     modalOverlay.style.bottom = 0;
//     modalOverlay.style.margin = 0;
//     modalOverlay.style.padding = 0;
//     modalOverlay.style.zIndex = '999999';
//     modalOverlay.style.background = 'rgba(0, 0, 0, .6)';
    
//     modalWindow = document.createElement('div');
//     modalWindow.style.backgroundColor = '#fcfaff';
//     modalWindow.style.borderRadius = '12px';
//     modalWindow.style.margin = 0;
//     modalWindow.style.padding = '32px';
//     modalWindow.style.paddingBottom = '52px';
//     modalWindow.style.marginBottom = '18vh';
//     modalOverlay.append(modalWindow);

//     modalHeader = document.createElement('div');
//     modalHeader.style.margin = 0;
//     modalHeader.style.display = 'flex';
//     modalHeader.style.padding = 0;

//     modalWindow.append(modalHeader);

//     modalTitle = document.createElement('div');
//     modalTitle.innerText = 'Oops… 😯';
//     modalTitle.style.font = 'normal 600 24px Arial';
//     modalTitle.style.color = '#0a102f';
//     modalTitle.style.textAlign = 'left';
//     modalTitle.style.margin = 0;
//     modalTitle.style.display = 'block';
//     modalTitle.style.padding = 0;
//     modalTitle.style.marginBottom = '26px';
//     modalHeader.append(modalTitle);

//     modalIcon = document.createElement('div');
//     modalIcon.style.margin = 0;
//     modalIcon.style.display = 'block';
//     modalIcon.style.padding = 0;
//     modalIcon.style.flexGrow = '1';
//     modalHeader.append(modalIcon);

//     modalCloseBtn = document.createElement('img');
//     modalCloseBtn.src = 'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2015%2015%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20style%3D%22width%3A%20var(--cb-icon-size%2C%2070%25)%3B%20height%3A%20var(--cb-icon-size%2C%2070%25)%3B%22%3E%3Cpath%20d%3D%22M11.7816%204.03157C12.0062%203.80702%2012.0062%203.44295%2011.7816%203.2184C11.5571%202.99385%2011.193%202.99385%2010.9685%203.2184L7.50005%206.68682L4.03164%203.2184C3.80708%202.99385%203.44301%202.99385%203.21846%203.2184C2.99391%203.44295%202.99391%203.80702%203.21846%204.03157L6.68688%207.49999L3.21846%2010.9684C2.99391%2011.193%202.99391%2011.557%203.21846%2011.7816C3.44301%2012.0061%203.80708%2012.0061%204.03164%2011.7816L7.50005%208.31316L10.9685%2011.7816C11.193%2012.0061%2011.5571%2012.0061%2011.7816%2011.7816C12.0062%2011.557%2012.0062%2011.193%2011.7816%2010.9684L8.31322%207.49999L11.7816%204.03157Z%22%20fill%3D%22currentColor%22%20fill-rule%3D%22evenodd%22%20clip-rule%3D%22evenodd%22%3E%3C%2Fpath%3E%3C%2Fsvg%3E';
//     modalCloseBtn.style.margin = 0;
//     modalCloseBtn.style.display = 'block';
//     modalCloseBtn.style.padding = 0;
//     modalCloseBtn.style.height = '20px';
//     modalCloseBtn.style.cursor = 'pointer';
//     modalHeader.append(modalCloseBtn);

//     modalContent = document.createElement('div');
//     modalContent.innerText = "It looks like you’ve left the job search page. LiftmyCV’s AI Agent can only\noperate and auto-fill application son specific supported pages. Please return\nto the search page or restart the auto-apply session.";
//     modalContent.style.font = 'normal 400 18px Arial';
//     modalContent.style.color = '#0a102f';
//     modalContent.style.margin = 0;
//     modalContent.style.display = 'block';
//     modalContent.style.padding = 0;
//     modalContent.style.lineHeight = '1.3';
//     modalContent.style.marginBottom = '50px';
//     modalWindow.append(modalContent);

//     modalCloseBtn.addEventListener('click', () => {
//         modalOverlay.remove();
//     });

//     modalButton = document.createElement('div');
//     modalButton.innerText = "Return";
//     modalButton.style.font = 'normal 700 16px Arial';
//     modalButton.style.color = '#ffffff';
//     modalButton.style.margin = 0;
//     modalButton.style.display = 'inline';
//     modalButton.style.padding = '15px 85px';
//     modalButton.style.borderRadius = '5px';
//     modalButton.style.textAlign = 'center';
//     modalButton.style.backgroundColor = '#a259ff';
//     modalButton.style.border = '2px solid #a259ff';
//     modalButton.style.cursor = 'pointer';
//     modalWindow.append(modalButton);

//     modalButton.addEventListener('mouseenter', () => {
//         modalButton.style.backgroundColor = '#ffffff';
//         modalButton.style.color = '#0A102F';
//       });
      
//     modalButton.addEventListener('mouseleave', () => {
//         modalButton.style.backgroundColor = '#a259ff';
//         modalButton.style.color = '#ffffff';
//     });

//     modalButton.addEventListener('click', f);

//     modalQuitBtn = document.createElement('div');
//     modalQuitBtn.innerText = "Close Tab";
//     modalQuitBtn.style.font = 'normal 700 16px Arial';
//     modalQuitBtn.style.margin = 0;
//     modalQuitBtn.style.display = 'inline';
//     modalQuitBtn.style.padding = '15px 85px';
//     modalQuitBtn.style.marginLeft = '16px';
//     modalQuitBtn.style.borderRadius = '5px';
//     modalQuitBtn.style.textAlign = 'center';
//     modalQuitBtn.style.backgroundColor = '#ffffff';
//     modalQuitBtn.style.color = '#0A102F';
//     modalQuitBtn.style.border = '2px solid #a259ff';
//     modalQuitBtn.style.cursor = 'pointer';
//     modalWindow.append(modalQuitBtn);

//     modalQuitBtn.addEventListener('mouseenter', () => {
//         modalQuitBtn.style.backgroundColor = '#a259ff';
//         modalQuitBtn.style.color = '#ffffff';
//       });
      
//     modalQuitBtn.addEventListener('mouseleave', () => {
//         modalQuitBtn.style.backgroundColor = '#ffffff';
//         modalQuitBtn.style.color = '#0A102F';
//     });

//     modalQuitBtn.addEventListener('click', () => {
//         modalWindow.remove();
//         chrome.runtime.sendMessage({type: 'STOP-APPLYING'});
//     });
    
//     document.body.append(modalOverlay);

// }

// function checkWrongReturned(data) {
//     if (data?.wrongReturned) {
//         searchPageLeaved(() => location.reload());
//         return true;
//     }
// }

// function showSkipDisabledModal(f) {
    
//     modalOverlay = document.createElement('div');
//     modalOverlay.style.position = 'fixed';
//     modalOverlay.style.display = 'flex';
//     modalOverlay.style.alignItems = 'center';
//     modalOverlay.style.justifyContent = 'center';
//     modalOverlay.style.top = 0;
//     modalOverlay.style.left = 0;
//     modalOverlay.style.right = 0;
//     modalOverlay.style.bottom = 0;
//     modalOverlay.style.margin = 0;
//     modalOverlay.style.padding = 0;
//     modalOverlay.style.zIndex = '999999';
//     modalOverlay.style.background = 'rgba(0, 0, 0, .6)';
    
//     modalWindow = document.createElement('div');
//     modalWindow.style.backgroundColor = '#fcfaff';
//     modalWindow.style.borderRadius = '12px';
//     modalWindow.style.margin = 0;
//     modalWindow.style.padding = '32px';
//     modalWindow.style.paddingBottom = '52px';
//     modalWindow.style.marginBottom = '18vh';
//     modalOverlay.append(modalWindow);

//     modalHeader = document.createElement('div');
//     modalHeader.style.margin = 0;
//     modalHeader.style.display = 'flex';
//     modalHeader.style.padding = 0;

//     modalWindow.append(modalHeader);

//     modalTitle = document.createElement('div');
//     modalTitle.innerText = 'Oops… 😯';
//     modalTitle.style.font = 'normal 600 24px Arial';
//     modalTitle.style.color = '#0a102f';
//     modalTitle.style.textAlign = 'left';
//     modalTitle.style.margin = 0;
//     modalTitle.style.display = 'block';
//     modalTitle.style.padding = 0;
//     modalTitle.style.marginBottom = '26px';
//     modalHeader.append(modalTitle);

//     modalIcon = document.createElement('div');
//     modalIcon.style.margin = 0;
//     modalIcon.style.display = 'block';
//     modalIcon.style.padding = 0;
//     modalIcon.style.flexGrow = '1';
//     modalHeader.append(modalIcon);

//     modalCloseBtn = document.createElement('img');
//     modalCloseBtn.src = 'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2015%2015%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20style%3D%22width%3A%20var(--cb-icon-size%2C%2070%25)%3B%20height%3A%20var(--cb-icon-size%2C%2070%25)%3B%22%3E%3Cpath%20d%3D%22M11.7816%204.03157C12.0062%203.80702%2012.0062%203.44295%2011.7816%203.2184C11.5571%202.99385%2011.193%202.99385%2010.9685%203.2184L7.50005%206.68682L4.03164%203.2184C3.80708%202.99385%203.44301%202.99385%203.21846%203.2184C2.99391%203.44295%202.99391%203.80702%203.21846%204.03157L6.68688%207.49999L3.21846%2010.9684C2.99391%2011.193%202.99391%2011.557%203.21846%2011.7816C3.44301%2012.0061%203.80708%2012.0061%204.03164%2011.7816L7.50005%208.31316L10.9685%2011.7816C11.193%2012.0061%2011.5571%2012.0061%2011.7816%2011.7816C12.0062%2011.557%2012.0062%2011.193%2011.7816%2010.9684L8.31322%207.49999L11.7816%204.03157Z%22%20fill%3D%22currentColor%22%20fill-rule%3D%22evenodd%22%20clip-rule%3D%22evenodd%22%3E%3C%2Fpath%3E%3C%2Fsvg%3E';
//     modalCloseBtn.style.margin = 0;
//     modalCloseBtn.style.display = 'block';
//     modalCloseBtn.style.padding = 0;
//     modalCloseBtn.style.height = '20px';
//     modalCloseBtn.style.cursor = 'pointer';
//     modalHeader.append(modalCloseBtn);

//     modalContent = document.createElement('div');
//     modalContent.innerText = "Free users can use the Skip feature only once. To continue, upgrade to\na monthly subscription or purchase a Pay-As-You-Go (PAYG) bundle.";
//     modalContent.style.font = 'normal 400 18px Arial';
//     modalContent.style.color = '#0a102f';
//     modalContent.style.margin = 0;
//     modalContent.style.display = 'block';
//     modalContent.style.padding = 0;
//     modalContent.style.lineHeight = '1.3';
//     modalContent.style.marginBottom = '50px';
//     modalWindow.append(modalContent);

//     modalButton = document.createElement('div');
//     modalButton.innerText = "Upgrade";
//     modalButton.style.font = 'normal 700 16px Arial';
//     modalButton.style.color = '#ffffff';
//     modalButton.style.margin = 0;
//     modalButton.style.display = 'inline';
//     modalButton.style.padding = '15px 85px';
//     modalButton.style.borderRadius = '5px';
//     modalButton.style.textAlign = 'center';
//     modalButton.style.backgroundColor = '#a259ff';
//     modalButton.style.border = '2px solid #a259ff';
//     modalButton.style.cursor = 'pointer';
//     modalWindow.append(modalButton);

//     modalButton.addEventListener('mouseenter', () => {
//         modalButton.style.backgroundColor = '#ffffff';
//         modalButton.style.color = '#0A102F';
//       });
      
//     modalButton.addEventListener('mouseleave', () => {
//         modalButton.style.backgroundColor = '#a259ff';
//         modalButton.style.color = '#ffffff';
//     });

//     modalCloseBtn.addEventListener('click', () => {
//         modalOverlay.remove();
//     });

//     modalButton.addEventListener('click', () => {
//         modalOverlay.remove();
//         window.open("https://app.liftmycv.com/#/buy-lifts");
//     });
    
//     document.body.append(modalOverlay);

// }

// function liftsOut(f) {
    
//     modalOverlay = document.createElement('div');
//     modalOverlay.style.position = 'fixed';
//     modalOverlay.style.display = 'flex';
//     modalOverlay.style.alignItems = 'center';
//     modalOverlay.style.justifyContent = 'center';
//     modalOverlay.style.top = 0;
//     modalOverlay.style.left = 0;
//     modalOverlay.style.right = 0;
//     modalOverlay.style.bottom = 0;
//     modalOverlay.style.margin = 0;
//     modalOverlay.style.padding = 0;
//     modalOverlay.style.zIndex = '999999';
//     modalOverlay.style.background = 'rgba(0, 0, 0, .6)';
    
//     modalWindow = document.createElement('div');
//     modalWindow.style.backgroundColor = '#fcfaff';
//     modalWindow.style.borderRadius = '12px';
//     modalWindow.style.margin = 0;
//     modalWindow.style.padding = '32px';
//     modalWindow.style.paddingBottom = '52px';
//     modalWindow.style.marginBottom = '18vh';
//     modalOverlay.append(modalWindow);

//     modalHeader = document.createElement('div');
//     modalHeader.style.margin = 0;
//     modalHeader.style.display = 'flex';
//     modalHeader.style.padding = 0;

//     modalWindow.append(modalHeader);

//     modalTitle = document.createElement('div');
//     modalTitle.innerText = 'Oops… 😯';
//     modalTitle.style.font = 'normal 600 24px Arial';
//     modalTitle.style.color = '#0a102f';
//     modalTitle.style.textAlign = 'left';
//     modalTitle.style.margin = 0;
//     modalTitle.style.display = 'block';
//     modalTitle.style.padding = 0;
//     modalTitle.style.marginBottom = '26px';
//     modalHeader.append(modalTitle);

//     modalIcon = document.createElement('div');
//     modalIcon.style.margin = 0;
//     modalIcon.style.display = 'block';
//     modalIcon.style.padding = 0;
//     modalIcon.style.flexGrow = '1';
//     modalHeader.append(modalIcon);

//     modalCloseBtn = document.createElement('img');
//     modalCloseBtn.src = 'data:image/svg+xml,%3Csvg%20viewBox%3D%220%200%2015%2015%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20style%3D%22width%3A%20var(--cb-icon-size%2C%2070%25)%3B%20height%3A%20var(--cb-icon-size%2C%2070%25)%3B%22%3E%3Cpath%20d%3D%22M11.7816%204.03157C12.0062%203.80702%2012.0062%203.44295%2011.7816%203.2184C11.5571%202.99385%2011.193%202.99385%2010.9685%203.2184L7.50005%206.68682L4.03164%203.2184C3.80708%202.99385%203.44301%202.99385%203.21846%203.2184C2.99391%203.44295%202.99391%203.80702%203.21846%204.03157L6.68688%207.49999L3.21846%2010.9684C2.99391%2011.193%202.99391%2011.557%203.21846%2011.7816C3.44301%2012.0061%203.80708%2012.0061%204.03164%2011.7816L7.50005%208.31316L10.9685%2011.7816C11.193%2012.0061%2011.5571%2012.0061%2011.7816%2011.7816C12.0062%2011.557%2012.0062%2011.193%2011.7816%2010.9684L8.31322%207.49999L11.7816%204.03157Z%22%20fill%3D%22currentColor%22%20fill-rule%3D%22evenodd%22%20clip-rule%3D%22evenodd%22%3E%3C%2Fpath%3E%3C%2Fsvg%3E';
//     modalCloseBtn.style.margin = 0;
//     modalCloseBtn.style.display = 'block';
//     modalCloseBtn.style.padding = 0;
//     modalCloseBtn.style.height = '20px';
//     modalCloseBtn.style.cursor = 'pointer';
//     modalHeader.append(modalCloseBtn);

//     modalContent = document.createElement('div');
//     modalContent.innerText = "You’ve run out of Lifts. Top up your balance to keep using\nthe AI agent for automatic job application filling.";
//     modalContent.style.font = 'normal 400 18px Arial';
//     modalContent.style.color = '#0a102f';
//     modalContent.style.margin = 0;
//     modalContent.style.display = 'block';
//     modalContent.style.padding = 0;
//     modalContent.style.lineHeight = '1.3';
//     modalContent.style.marginBottom = '50px';
//     modalWindow.append(modalContent);

//     modalButton = document.createElement('div');
//     modalButton.innerText = "Top up";
//     modalButton.style.font = 'normal 700 16px Arial';
//     modalButton.style.color = '#ffffff';
//     modalButton.style.margin = 0;
//     modalButton.style.display = 'inline';
//     modalButton.style.padding = '15px 85px';
//     modalButton.style.borderRadius = '5px';
//     modalButton.style.textAlign = 'center';
//     modalButton.style.backgroundColor = '#a259ff';
//     modalButton.style.border = '2px solid #a259ff';
//     modalButton.style.cursor = 'pointer';
//     modalWindow.append(modalButton);

//     modalButton.addEventListener('mouseenter', () => {
//         modalButton.style.backgroundColor = '#ffffff';
//         modalButton.style.color = '#0A102F';
//       });
      
//     modalButton.addEventListener('mouseleave', () => {
//         modalButton.style.backgroundColor = '#a259ff';
//         modalButton.style.color = '#ffffff';
//     });

//     modalCloseBtn.addEventListener('click', () => {
//         modalOverlay.remove();
//     });

//     modalButton.addEventListener('click', () => {
//         modalOverlay.remove();
//         window.open("https://app.liftmycv.com/#/buy-lifts");
//     });
    
//     document.body.append(modalOverlay);

// }

// function warmingUp(geometry, agentMessages, agentMode) {
//     if (agentStatus.alreadyWarmed) {
//         const blockElOld = document.getElementById(STATUS_BLOCK_ELEMENT_ID);
//         if (blockElOld) {
//             blockElOld.style.display = 'flex';
//         }
//         return;
//     }
//     agentStatus.alreadyWarmed = true;

//     agentStatus.isApplyOne = geometry?.isApplyOne;

//     agentStatus.windowStatus = geometry?.windowStatus ?? 'normal';
//     agentStatus.normalGeometry = geometry?.normalGeometry;
//     agentStatus.agentMode = agentMode;

//     let blockEl = document.createElement('div');
//     blockEl.id = STATUS_BLOCK_ELEMENT_ID;

//     blockEl.style.top = (geometry?.top ?? 25) + 'px';
//     blockEl.style.left = (geometry?.left ?? 25) + 'px';
//     blockEl.style.width = (geometry?.width ?? 375) + 'px';
//     blockEl.style.height = (geometry?.height ?? 530) + 'px';

//     blockEl.style.color = '#0A102F';
//     blockEl.style.zIndex = '999997';
//     blockEl.style.position = 'fixed';
//     blockEl.style.background = '#fafafa';
//     blockEl.style.borderRadius = '16px';
//     blockEl.style.boxShadow = '0px 8px 40px rgba(0, 0, 0, 0.1)';
//     blockEl.style.display = 'flex';
//     blockEl.style.overflow = 'hidden';
//     blockEl.style.flexDirection = 'column';


//     let titleWrapperEl = document.createElement('div');
//     titleWrapperEl.style.display = 'flex';
//     titleWrapperEl.position = 'relative';
//     titleWrapperEl.style.alignItems = 'center';
//     titleWrapperEl.style.cursor = 'move';
//     titleWrapperEl.style.backgroundColor = '#ffffff';
//     titleWrapperEl.style.borderBottom = '0.5px solid #E6E7EA';
//     //titleWrapperEl.style.height = '24px';
//     titleWrapperEl.style.padding = '12px 16px';


//     let closeBtn = document.createElement('div');
//     closeBtn.innerHTML = `
//         <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <rect width="14" height="14" rx="7" fill="#E6E7EA" fill-opacity="0.5"/>
//         <path d="M10.0338 9.59158C10.0628 9.62061 10.0858 9.65508 10.1015 9.69302C10.1173 9.73095 10.1253 9.77161 10.1253 9.81267C10.1253 9.85373 10.1173 9.89439 10.1015 9.93233C10.0858 9.97026 10.0628 10.0047 10.0338 10.0338C10.0047 10.0628 9.97026 10.0858 9.93233 10.1015C9.89439 10.1173 9.85373 10.1253 9.81267 10.1253C9.77161 10.1253 9.73095 10.1173 9.69302 10.1015C9.65508 10.0858 9.62061 10.0628 9.59158 10.0338L7.00017 7.44197L4.40877 10.0338C4.35013 10.0924 4.2706 10.1253 4.18767 10.1253C4.10475 10.1253 4.02522 10.0924 3.96658 10.0338C3.90794 9.97513 3.875 9.8956 3.875 9.81267C3.875 9.72975 3.90794 9.65022 3.96658 9.59158L6.55838 7.00017L3.96658 4.40877C3.90794 4.35013 3.875 4.2706 3.875 4.18767C3.875 4.10475 3.90794 4.02522 3.96658 3.96658C4.02522 3.90794 4.10475 3.875 4.18767 3.875C4.2706 3.875 4.35013 3.90794 4.40877 3.96658L7.00017 6.55838L9.59158 3.96658C9.65022 3.90794 9.72975 3.875 9.81267 3.875C9.8956 3.875 9.97513 3.90794 10.0338 3.96658C10.0924 4.02522 10.1253 4.10475 10.1253 4.18767C10.1253 4.2706 10.0924 4.35013 10.0338 4.40877L7.44197 7.00017L10.0338 9.59158Z" fill="#6D717D"/>
//         <path fill-rule="evenodd" clip-rule="evenodd" d="M10.2105 9.4148C10.2628 9.46705 10.3042 9.52908 10.3325 9.59735C10.3608 9.66561 10.3753 9.73878 10.3753 9.81267C10.3753 9.88657 10.3608 9.95974 10.3325 10.028C10.3042 10.0963 10.2628 10.1583 10.2105 10.2105C10.1583 10.2628 10.0963 10.3042 10.028 10.3325C9.95974 10.3608 9.88657 10.3753 9.81267 10.3753C9.73878 10.3753 9.66561 10.3608 9.59735 10.3325C9.52908 10.3042 9.46705 10.2628 9.4148 10.2105L7.00017 7.79555L4.58556 10.2105C4.48004 10.3161 4.3369 10.3753 4.18767 10.3753C4.03844 10.3753 3.89532 10.3161 3.7898 10.2105C3.68428 10.105 3.625 9.9619 3.625 9.81267C3.625 9.66344 3.68428 9.52033 3.7898 9.4148L6.2048 7.00017L3.78982 4.58556C3.68429 4.48004 3.625 4.3369 3.625 4.18767C3.625 4.03844 3.68428 3.89533 3.7898 3.7898C3.89533 3.68428 4.03844 3.625 4.18767 3.625C4.3369 3.625 4.48002 3.68428 4.58554 3.7898L7.00017 6.2048L9.41479 3.78982C9.52031 3.68429 9.66344 3.625 9.81267 3.625C9.9619 3.625 10.105 3.68428 10.2105 3.7898C10.3161 3.89532 10.3753 4.03844 10.3753 4.18767C10.3753 4.3369 10.3161 4.48002 10.2105 4.58554L7.79555 7.00017L10.2105 9.4148ZM10.0338 9.59158C10.0628 9.62062 10.0858 9.65508 10.1015 9.69302C10.1173 9.73095 10.1253 9.77161 10.1253 9.81267C10.1253 9.85374 10.1173 9.89439 10.1015 9.93233C10.0858 9.97026 10.0628 10.0047 10.0338 10.0338C10.0047 10.0628 9.97026 10.0858 9.93233 10.1015C9.89439 10.1173 9.85374 10.1253 9.81267 10.1253C9.77161 10.1253 9.73095 10.1173 9.69302 10.1015C9.65508 10.0858 9.62062 10.0628 9.59158 10.0338L7.00017 7.44197L4.40877 10.0338C4.35013 10.0924 4.2706 10.1253 4.18767 10.1253C4.10475 10.1253 4.02522 10.0924 3.96658 10.0338C3.90794 9.97513 3.875 9.8956 3.875 9.81267C3.875 9.72975 3.90794 9.65022 3.96658 9.59158L6.55838 7.00017L3.96658 4.40877C3.90794 4.35013 3.875 4.2706 3.875 4.18767C3.875 4.10475 3.90794 4.02522 3.96658 3.96658C4.02522 3.90794 4.10475 3.875 4.18767 3.875C4.2706 3.875 4.35013 3.90794 4.40877 3.96658L7.00017 6.55838L9.59158 3.96658C9.65022 3.90794 9.72975 3.875 9.81267 3.875C9.8956 3.875 9.97513 3.90794 10.0338 3.96658C10.0924 4.02522 10.1253 4.10475 10.1253 4.18767C10.1253 4.2706 10.0924 4.35013 10.0338 4.40877L7.44197 7.00017L10.0338 9.59158Z" fill="#6D717D"/>
//         </svg>
//     `;
//     closeBtn.style.cursor = 'pointer';
//     closeBtn.style.marginRight = '6px';
//     closeBtn.style.marginTop = '6px';
//     closeBtn.style.marginBottom = '2px';
//     closeBtn.style.zIndex = '999998';
//     titleWrapperEl.append(closeBtn);

//     let minimizeBtn = document.createElement('div');
//     minimizeBtn.innerHTML = `
//         <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <rect width="14" height="14" rx="7" fill="#E6E7EA" fill-opacity="0.5"/>
//         <g clip-path="url(#clip0_3167_27464)">
//         <path d="M16.25 7.1665C16.25 7.69694 16.1362 8.20564 15.9337 8.58072C15.7311 8.95579 15.4564 9.1665 15.17 9.1665H-0.67C-0.956434 9.1665 -1.23114 8.95579 -1.43368 8.58072C-1.63621 8.20564 -1.75 7.69694 -1.75 7.1665C-1.75 6.63607 -1.63621 6.12736 -1.43368 5.75229C-1.23114 5.37722 -0.956434 5.1665 -0.67 5.1665H15.17C15.4564 5.1665 15.7311 5.37722 15.9337 5.75229C16.1362 6.12736 16.25 6.63607 16.25 7.1665Z" fill="#6D717D"/>
//         </g>
//         <defs>
//         <clipPath id="clip0_3167_27464">
//         <rect x="3.25" y="6.1665" width="7.5" height="1.66667" rx="0.833333" fill="white"/>
//         </clipPath>
//         </defs>
//         </svg>
//     `;
//     minimizeBtn.style.cursor = 'pointer';
//     minimizeBtn.style.marginRight = '6px';
//     minimizeBtn.style.marginTop = '6px';
//     minimizeBtn.style.marginBottom = '2px';
//     minimizeBtn.style.zIndex = '999998';
//     titleWrapperEl.append(minimizeBtn);

//     let maximizeBtn = document.createElement('div');
//     maximizeBtn.innerHTML = `
//         <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <rect width="14" height="14" rx="7" fill="#E6E7EA" fill-opacity="0.5"/>
//         <path fill-rule="evenodd" clip-rule="evenodd" d="M10 6.62133C10.0001 6.17581 9.4614 5.95268 9.1464 6.26775L6.26856 9.14628C5.95366 9.46125 6.17669 9.99972 6.62208 9.99979L8.9997 10.0001C9.55195 10.0001 9.99965 9.55244 9.99965 9.00018L10 6.62133ZM4.99991 4.00035C4.44766 4.00035 3.99997 4.44805 3.99997 5.00032L4.00032 7.37816C4.00039 7.82353 4.53881 8.04657 4.8538 7.73171L7.73309 4.85363C8.0482 4.53865 7.82508 3.99993 7.37954 4L4.99991 4.00035Z" fill="#6D717D"/>
//         </svg>
//     `;
//     maximizeBtn.style.cursor = 'pointer';
//     maximizeBtn.style.marginTop = '6px';
//     maximizeBtn.style.marginBottom = '2px';
//     maximizeBtn.style.zIndex = '999998';
//     titleWrapperEl.append(maximizeBtn);

//     let titleEl = document.createElement('div');
//     titleEl.style.position = 'absolute';
//     titleEl.style.width = '100%';
//     titleEl.style.left = 0;
//     titleEl.style.display = 'flex';
//     titleEl.style.justifyContent = 'center';
//     titleEl.style.marginTop = '5px';
//     let titleBtn = document.createElement('div');
    
//     titleBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <path d="M22.009 0H2.00082C0.895797 0 0 0.895431 0 2V22C0 23.1046 0.895797 24 2.00082 24H22.009C23.114 24 24.0098 23.1046 24.0098 22V2C24.0098 0.895431 23.114 0 22.009 0Z" fill="#A259FF"/>
//         <path d="M15.7025 13.0394C15.9642 13.2992 15.9642 13.7208 15.7025 13.9806C15.4412 14.24 15.0179 14.24 14.7568 13.9806L12.3819 11.6224C12.1996 11.4414 11.9038 11.4414 11.7214 11.6224L12 11L15.7025 13.0394ZM15.7025 13.0394L12.9244 10.2833C12.4412 9.80412 11.6587 9.8043 11.1758 10.2837L8.39876 13.0414C8.13712 13.3013 8.13712 13.7228 8.39876 13.9826C8.66002 14.2421 9.08331 14.2421 9.34457 13.9826L11.7214 11.6224L12 11L15.7025 13.0394Z" fill="white"/>
//         <path fill-rule="evenodd" clip-rule="evenodd" d="M6.41193 8.8565C6.2343 9.65576 6.16051 10.6928 6.16051 12.0506C6.16051 13.4085 6.2343 14.4455 6.41193 15.2448C6.58755 16.035 6.85396 16.5434 7.20593 16.8953C7.5579 17.2473 8.06626 17.5137 8.8565 17.6893C9.65576 17.867 10.6928 17.9408 12.0506 17.9408C13.4085 17.9408 14.4455 17.867 15.2448 17.6893C16.035 17.5137 16.5434 17.2473 16.8953 16.8953C17.2473 16.5434 17.5137 16.035 17.6893 15.2448C17.867 14.4455 17.9408 13.4085 17.9408 12.0506C17.9408 10.6928 17.867 9.65576 17.6893 8.8565C17.5137 8.06626 17.2473 7.5579 16.8953 7.20593C16.5434 6.85396 16.035 6.58755 15.2448 6.41193C14.4455 6.2343 13.4085 6.16051 12.0506 6.16051C10.6928 6.16051 9.65576 6.2343 8.8565 6.41193C8.06626 6.58755 7.5579 6.85396 7.20593 7.20593C6.85396 7.5579 6.58755 8.06626 6.41193 8.8565ZM8.51224 4.86289C9.48214 4.64733 10.6565 4.57367 12.0506 4.57367C13.4447 4.57367 14.6191 4.64733 15.589 4.86289C16.5679 5.08044 17.3865 5.45294 18.0174 6.08387C18.6483 6.7148 19.0208 7.53333 19.2384 8.51224C19.4539 9.48214 19.5276 10.6565 19.5276 12.0506C19.5276 13.4447 19.4539 14.6191 19.2384 15.589C19.0208 16.5679 18.6483 17.3865 18.0174 18.0174C17.3865 18.6483 16.5679 19.0208 15.589 19.2384C14.6191 19.4539 13.4447 19.5276 12.0506 19.5276C10.6565 19.5276 9.48214 19.4539 8.51224 19.2384C7.53333 19.0208 6.7148 18.6483 6.08387 18.0174C5.45294 17.3865 5.08044 16.5679 4.86289 15.589C4.64733 14.6191 4.57367 13.4447 4.57367 12.0506C4.57367 10.6565 4.64733 9.48214 4.86289 8.51224C5.08044 7.53333 5.45294 6.7148 6.08387 6.08387C6.7148 5.45294 7.53333 5.08044 8.51224 4.86289Z" fill="white"/>
//         </svg>
//     `;
//     titleEl.append(titleBtn);
//     titleWrapperEl.append(titleEl);

//     let titleGrowEl = document.createElement('div');
//     titleGrowEl.style.flexGrow = 1;
//     titleWrapperEl.append(titleGrowEl);

//     {

//         // TIMER

//         let timerWrapperEl = document.createElement('p');
//         timerWrapperEl.style.fontSize = '12px';

//         let timerLabelEl = document.createElement('span');
//         timerLabelEl.style.color = '#6D717D';
//         timerLabelEl.innerText = (agentStatus.agentMode == 'Copilot') ? 'Copilot is active': 'Autopilot is active';
//         timerLabelEl.classList.add(classes.activityTimerLabel);
//         timerWrapperEl.append(timerLabelEl);

//         let timerValueEl = document.createElement('span');
//         timerValueEl.style.color = '#0A102F';
//         timerValueEl.style.fontWeight = 'bold';
//         timerValueEl.classList.add(classes.activityTimerValue);
//         timerWrapperEl.append(timerValueEl);

//         titleWrapperEl.append(timerWrapperEl);

//     }

//     blockEl.append(titleWrapperEl);

//     let listWrapperEl = document.createElement('div');
//     listWrapperEl.classList.add(classes.activityListWrapper);
//     listWrapperEl.style.overflowY = 'auto';
//     listWrapperEl.style.overflowX = 'hidden';
//     listWrapperEl.style.whiteSpace = 'break-word';
//     listWrapperEl.style.paddingRight = '4px';
//     listWrapperEl.style.flexGrow = 1;
//     blockEl.append(listWrapperEl);

//     let bottomEl = document.createElement('div');
//     //bottomEl.style.height = '40px';
//     bottomEl.style.padding = '16px';
//     bottomEl.style.backgroundColor = '#ffffff';
//     bottomEl.style.display = 'grid'; 
//     bottomEl.style.gap = '16px';
//     titleWrapperEl.style.borderTop = '0.5px solid #E6E7EA';
//     if (!agentStatus.search) {
//         blockEl.append(bottomEl);
//     }

//     let switchCopilotBtn = document.createElement('div');
//     switchCopilotBtn.style.height = '40px';
//     switchCopilotBtn.style.backgroundColor = '#0a102f';
//     switchCopilotBtn.style.display = 'flex';
//     switchCopilotBtn.style.alignItems = 'center';
//     switchCopilotBtn.style.justifyContent = 'center';
//     switchCopilotBtn.style.borderRadius = '6px';
//     switchCopilotBtn.style.color = '#ffffff';
//     let switchCopilotIcon = document.createElement('div');
//     switchCopilotIcon.innerHTML = `
//         <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <path d="M17.6835 10.4559L17.196 6.74648L16.4648 4.11863C16.4648 4.11863 16.1068 3.71493 15.8478 3.61591C15.5888 3.51689 15.0176 3.46357 14.1035 3.66161C13.1895 3.85965 13.2657 4.12625 13.2657 4.12625C13.2657 4.12625 13.3571 5.19262 13.3647 5.30688C13.3723 5.42113 13.3418 5.86292 13.3418 5.86292L13.1666 6.26662L13.1538 6.37814C13.1495 6.41564 13.1544 6.45358 13.1683 6.48868C13.2071 6.5868 13.2986 6.81073 13.4332 7.09687C13.6161 7.48533 14.7129 7.62244 14.7129 7.62244C14.7129 7.62244 15.01 8.35366 15.2842 9.33625C15.5584 10.3188 15.6955 10.9587 15.2842 11.3471C14.8728 11.7356 13.4104 10.5245 13.4104 10.5245C13.4104 10.5245 11.1482 6.47989 10.9653 6.29708C10.7825 6.11428 9.00017 6.11428 9.00017 6.11428C9.00017 6.11428 7.2178 6.11428 7.03499 6.29708C6.85218 6.47989 4.58994 10.5245 4.58994 10.5245C4.58994 10.5245 3.12748 11.7356 2.71617 11.3471C2.30485 10.9587 2.44196 10.3188 2.71617 9.33625C2.99038 8.35366 3.28744 7.62244 3.28744 7.62244C3.28744 7.62244 4.38428 7.48533 4.56709 7.09687C4.70174 6.81073 4.79319 6.5868 4.83202 6.48868C4.84591 6.45358 4.85088 6.41564 4.84655 6.37814L4.83368 6.26662L4.65849 5.86292C4.65849 5.86292 4.62803 5.42113 4.63564 5.30688C4.64326 5.19262 4.73466 4.12625 4.73466 4.12625C4.73466 4.12625 4.81083 3.85965 3.8968 3.66161C2.98276 3.46357 2.41149 3.51689 2.15251 3.61591C1.89353 3.71493 1.53554 4.11863 1.53554 4.11863L0.804307 6.74648L0.316821 10.4559C0.316821 10.4559 0.134013 12.0327 0.933795 12.7639C1.73358 13.4951 3.33314 12.9924 3.33314 12.9924L4.97841 12.7182L7.01214 12.6953L9.00017 12.6725L10.9882 12.6953L13.0219 12.7182L14.6672 12.9924C14.6672 12.9924 16.2668 13.4951 17.0665 12.7639C17.8663 12.0327 17.6835 10.4559 17.6835 10.4559Z" fill="white"/>
//         <path d="M8.99995 7.44727C7.9693 7.44727 7.13379 8.28277 7.13379 9.31342C7.13379 10.3441 7.9693 11.1796 8.99995 11.1796C10.0306 11.1796 10.8661 10.3441 10.8661 9.31342C10.8661 8.28277 10.0306 7.44727 8.99995 7.44727Z" fill="#0A102F"/>
//         <path d="M3.76737 4.31641C3.57386 4.31641 3.41699 4.47328 3.41699 4.66679C3.41699 4.8603 3.57386 5.01717 3.76737 5.01717C3.96088 5.01717 4.11775 4.8603 4.11775 4.66679C4.11775 4.47328 3.96088 4.31641 3.76737 4.31641Z" fill="#0A102F"/>
//         <path d="M14.1414 4.31641C13.9479 4.31641 13.791 4.47328 13.791 4.66679C13.791 4.8603 13.9479 5.01717 14.1414 5.01717C14.3349 5.01717 14.4918 4.8603 14.4918 4.66679C14.4918 4.47328 14.3349 4.31641 14.1414 4.31641Z" fill="#0A102F"/>
//         </svg>
//     `;
//     switchCopilotIcon.style.marginRight = '6px';
//     switchCopilotIcon.style.marginTop = '3px';
//     switchCopilotBtn.style.cursor = 'pointer';
//     switchCopilotBtn.append(switchCopilotIcon);
//     switchCopilotBtn.append(document.createTextNode('SWITCH TO COPILOT'));
//     bottomEl.append(switchCopilotBtn);

//     let customStartBtn = document.createElement('div');
//     customStartBtn.style.height = '40px';
//     customStartBtn.style.backgroundColor = '#0a102f';
//     customStartBtn.style.display = 'none';
//     customStartBtn.style.alignItems = 'center';
//     customStartBtn.style.justifyContent = 'center';
//     customStartBtn.style.borderRadius = '6px';
//     customStartBtn.style.color = '#ffffff';
//     let customStartIcon = document.createElement('div');
//     customStartIcon.innerHTML = `
//         <svg width="19" height="18" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <path d="M17.375 8.99986C17.3755 9.19085 17.3265 9.37871 17.2329 9.54516C17.1392 9.71162 17.0041 9.85101 16.8406 9.94978L6.71 16.1471C6.5392 16.2517 6.34358 16.3088 6.14334 16.3125C5.94309 16.3162 5.74549 16.2664 5.57094 16.1682C5.39805 16.0716 5.25402 15.9306 5.15368 15.7598C5.05333 15.589 5.00029 15.3946 5 15.1965V2.80322C5.00029 2.60514 5.05333 2.41071 5.15368 2.23993C5.25402 2.06914 5.39805 1.92817 5.57094 1.8315C5.74549 1.73331 5.94309 1.6835 6.14334 1.6872C6.34358 1.69091 6.5392 1.74801 6.71 1.8526L16.8406 8.04994C17.0041 8.14871 17.1392 8.2881 17.2329 8.45456C17.3265 8.62102 17.3755 8.80887 17.375 8.99986Z" fill="white"/>
//         </svg>
//     `;
//     customStartIcon.style.marginRight = '6px';
//     customStartIcon.style.marginTop = '3px';
//     customStartBtn.style.cursor = 'pointer';
//     customStartBtn.append(customStartIcon);
//     customStartBtn.append(document.createTextNode('START AUTO-APPLY'));
//     bottomEl.append(customStartBtn);

//     let applyOneBtn = document.createElement('div');
//     applyOneBtn.style.height = '40px';
//     applyOneBtn.style.backgroundColor = '#0a102f';
//     applyOneBtn.style.display = 'none';
//     applyOneBtn.style.alignItems = 'center';
//     applyOneBtn.style.justifyContent = 'center';
//     applyOneBtn.style.borderRadius = '6px';
//     applyOneBtn.style.color = '#ffffff';
//     let applyOneIcon = document.createElement('div');
//     applyOneIcon.innerHTML = `
//         <svg width="19" height="18" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <path d="M17.375 8.99986C17.3755 9.19085 17.3265 9.37871 17.2329 9.54516C17.1392 9.71162 17.0041 9.85101 16.8406 9.94978L6.71 16.1471C6.5392 16.2517 6.34358 16.3088 6.14334 16.3125C5.94309 16.3162 5.74549 16.2664 5.57094 16.1682C5.39805 16.0716 5.25402 15.9306 5.15368 15.7598C5.05333 15.589 5.00029 15.3946 5 15.1965V2.80322C5.00029 2.60514 5.05333 2.41071 5.15368 2.23993C5.25402 2.06914 5.39805 1.92817 5.57094 1.8315C5.74549 1.73331 5.94309 1.6835 6.14334 1.6872C6.34358 1.69091 6.5392 1.74801 6.71 1.8526L16.8406 8.04994C17.0041 8.14871 17.1392 8.2881 17.2329 8.45456C17.3265 8.62102 17.3755 8.80887 17.375 8.99986Z" fill="white"/>
//         </svg>
//     `;
//     applyOneIcon.style.marginRight = '6px';
//     applyOneIcon.style.marginTop = '3px';
//     applyOneBtn.style.cursor = 'pointer';
//     applyOneBtn.append(applyOneIcon);
//     applyOneBtn.append(document.createTextNode('AUTO-APPLY'));
//     bottomEl.append(applyOneBtn);

//     let historyBtn = document.createElement('div');
//     historyBtn.style.height = '40px';
//     historyBtn.style.backgroundColor = '#0a102f';
//     historyBtn.style.display = 'none';
//     historyBtn.style.alignItems = 'center';
//     historyBtn.style.justifyContent = 'center';
//     historyBtn.style.borderRadius = '6px';
//     historyBtn.style.color = '#ffffff';
//     historyBtn.style.cursor = 'pointer';
//     historyBtn.append(document.createTextNode('Check History'));
//     bottomEl.append(historyBtn);

//     let skipJobBtn = document.createElement('div');
//     skipJobBtn.style.height = '40px';
//     skipJobBtn.style.backgroundColor = '#ffffff';
//     skipJobBtn.style.border = '1px solid #0A102F';
//     skipJobBtn.style.display = 'none';
//     skipJobBtn.style.alignItems = 'center';
//     skipJobBtn.style.justifyContent = 'center';
//     skipJobBtn.style.borderRadius = '6px';
//     skipJobBtn.style.color = '#0A102F';
//     let skipJobIcon = document.createElement('div');
//     skipJobIcon.innerHTML = `
//         <svg width="19" height="18" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <path d="M15.125 2.8125V15.1875C15.125 15.3367 15.0657 15.4798 14.9602 15.5852C14.8548 15.6907 14.7117 15.75 14.5625 15.75C14.4133 15.75 14.2702 15.6907 14.1648 15.5852C14.0593 15.4798 14 15.3367 14 15.1875V10.3198L5.59273 15.5777C5.42342 15.684 5.22878 15.7431 5.02895 15.7489C4.82913 15.7547 4.63139 15.707 4.45621 15.6107C4.28102 15.5144 4.13477 15.373 4.03258 15.2012C3.93039 15.0294 3.87599 14.8333 3.875 14.6334V3.36656C3.87599 3.16666 3.93039 2.97065 4.03258 2.79883C4.13477 2.62702 4.28102 2.48564 4.45621 2.38933C4.63139 2.29303 4.82913 2.2453 5.02895 2.25109C5.22878 2.25688 5.42342 2.31598 5.59273 2.42227L14 7.68023V2.8125C14 2.66332 14.0593 2.52024 14.1648 2.41475C14.2702 2.30926 14.4133 2.25 14.5625 2.25C14.7117 2.25 14.8548 2.30926 14.9602 2.41475C15.0657 2.52024 15.125 2.66332 15.125 2.8125Z" fill="#0A102F"/>
//         </svg>
//     `;
//     skipJobIcon.style.marginRight = '6px';
//     skipJobIcon.style.marginTop = '3px';
//     skipJobBtn.style.cursor = 'pointer';
//     skipJobBtn.append(skipJobIcon);
//     skipJobBtn.append(document.createTextNode('SKIP JOB'));
//     bottomEl.append(skipJobBtn);

//     let takeControlBtn = document.createElement('div');
//     takeControlBtn.style.height = '40px';
//     takeControlBtn.style.color = '#0A102F';
//     takeControlBtn.style.backgroundColor = '#0a102f';
//     takeControlBtn.style.border = '1px solid #0A102F';
//     takeControlBtn.style.display = 'none';
//     takeControlBtn.style.alignItems = 'center';
//     takeControlBtn.style.justifyContent = 'center';
//     takeControlBtn.style.borderRadius = '6px';
//     takeControlBtn.style.color = '#ffffff';
//     let takeControlIcon = document.createElement('div');
//     takeControlIcon.innerHTML = `
//         <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <path d="M17.6835 10.4559L17.196 6.74648L16.4648 4.11863C16.4648 4.11863 16.1068 3.71493 15.8478 3.61591C15.5888 3.51689 15.0176 3.46357 14.1035 3.66161C13.1895 3.85965 13.2657 4.12625 13.2657 4.12625C13.2657 4.12625 13.3571 5.19262 13.3647 5.30688C13.3723 5.42113 13.3418 5.86292 13.3418 5.86292L13.1666 6.26662L13.1538 6.37814C13.1495 6.41564 13.1544 6.45358 13.1683 6.48868C13.2071 6.5868 13.2986 6.81073 13.4332 7.09687C13.6161 7.48533 14.7129 7.62244 14.7129 7.62244C14.7129 7.62244 15.01 8.35366 15.2842 9.33625C15.5584 10.3188 15.6955 10.9587 15.2842 11.3471C14.8728 11.7356 13.4104 10.5245 13.4104 10.5245C13.4104 10.5245 11.1482 6.47989 10.9653 6.29708C10.7825 6.11428 9.00017 6.11428 9.00017 6.11428C9.00017 6.11428 7.2178 6.11428 7.03499 6.29708C6.85218 6.47989 4.58994 10.5245 4.58994 10.5245C4.58994 10.5245 3.12748 11.7356 2.71617 11.3471C2.30485 10.9587 2.44196 10.3188 2.71617 9.33625C2.99038 8.35366 3.28744 7.62244 3.28744 7.62244C3.28744 7.62244 4.38428 7.48533 4.56709 7.09687C4.70174 6.81073 4.79319 6.5868 4.83202 6.48868C4.84591 6.45358 4.85088 6.41564 4.84655 6.37814L4.83368 6.26662L4.65849 5.86292C4.65849 5.86292 4.62803 5.42113 4.63564 5.30688C4.64326 5.19262 4.73466 4.12625 4.73466 4.12625C4.73466 4.12625 4.81083 3.85965 3.8968 3.66161C2.98276 3.46357 2.41149 3.51689 2.15251 3.61591C1.89353 3.71493 1.53554 4.11863 1.53554 4.11863L0.804307 6.74648L0.316821 10.4559C0.316821 10.4559 0.134013 12.0327 0.933795 12.7639C1.73358 13.4951 3.33314 12.9924 3.33314 12.9924L4.97841 12.7182L7.01214 12.6953L9.00017 12.6725L10.9882 12.6953L13.0219 12.7182L14.6672 12.9924C14.6672 12.9924 16.2668 13.4951 17.0665 12.7639C17.8663 12.0327 17.6835 10.4559 17.6835 10.4559Z" fill="white"/>
//         <path d="M8.99995 7.44727C7.9693 7.44727 7.13379 8.28277 7.13379 9.31342C7.13379 10.3441 7.9693 11.1796 8.99995 11.1796C10.0306 11.1796 10.8661 10.3441 10.8661 9.31342C10.8661 8.28277 10.0306 7.44727 8.99995 7.44727Z" fill="#0A102F"/>
//         <path d="M3.76737 4.31641C3.57386 4.31641 3.41699 4.47328 3.41699 4.66679C3.41699 4.8603 3.57386 5.01717 3.76737 5.01717C3.96088 5.01717 4.11775 4.8603 4.11775 4.66679C4.11775 4.47328 3.96088 4.31641 3.76737 4.31641Z" fill="#0A102F"/>
//         <path d="M14.1414 4.31641C13.9479 4.31641 13.791 4.47328 13.791 4.66679C13.791 4.8603 13.9479 5.01717 14.1414 5.01717C14.3349 5.01717 14.4918 4.8603 14.4918 4.66679C14.4918 4.47328 14.3349 4.31641 14.1414 4.31641Z" fill="#0A102F"/>
//         </svg>
//     `;
//     takeControlIcon.style.marginRight = '6px';
//     takeControlIcon.style.marginTop = '3px';
//     takeControlBtn.style.cursor = 'pointer';
//     takeControlBtn.append(takeControlIcon);
//     takeControlBtn.append(document.createTextNode('TAKE CONTROL'));
//     bottomEl.append(takeControlBtn);


//     let continueBtn = document.createElement('div');
//     continueBtn.style.height = '40px';
//     continueBtn.style.color = '#0A102F';
//     continueBtn.style.backgroundColor = '#0a102f';
//     continueBtn.style.border = '1px solid #0A102F';
//     continueBtn.style.display = 'none';
//     continueBtn.style.alignItems = 'center';
//     continueBtn.style.justifyContent = 'center';
//     continueBtn.style.borderRadius = '6px';
//     continueBtn.style.color = '#ffffff';
//     let continueIcon = document.createElement('div');
//     continueIcon.innerHTML = `
//         <svg width="19" height="18" viewBox="0 0 19 18" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <path d="M17.375 8.99986C17.3755 9.19085 17.3265 9.37871 17.2329 9.54516C17.1392 9.71162 17.0041 9.85101 16.8406 9.94978L6.71 16.1471C6.5392 16.2517 6.34358 16.3088 6.14334 16.3125C5.94309 16.3162 5.74549 16.2664 5.57094 16.1682C5.39805 16.0716 5.25402 15.9306 5.15368 15.7598C5.05333 15.589 5.00029 15.3946 5 15.1965V2.80322C5.00029 2.60514 5.05333 2.41071 5.15368 2.23993C5.25402 2.06914 5.39805 1.92817 5.57094 1.8315C5.74549 1.73331 5.94309 1.6835 6.14334 1.6872C6.34358 1.69091 6.5392 1.74801 6.71 1.8526L16.8406 8.04994C17.0041 8.14871 17.1392 8.2881 17.2329 8.45456C17.3265 8.62102 17.3755 8.80887 17.375 8.99986Z" fill="white"/>
//         </svg>
//     `;
//     continueIcon.style.marginRight = '6px';
//     continueIcon.style.marginTop = '3px';
//     continueBtn.style.cursor = 'pointer';
//     continueBtn.append(continueIcon);
//     continueBtn.append(document.createTextNode('CONTINUE'));
//     bottomEl.append(continueBtn);

//     agentStatus.removeButtons = () => {
//         blockEl.removeChild(bottomEl);
//         agentStatus.search = true;
//         document.querySelector(`.${classes.activityTimerValue}`).innerText = '';
//         document.querySelector(`.${classes.activityTimerLabel}`).innerText = '';
//     }

//     agentStatus.setButtons = (m) => {
//         if (m == 0 || m == 5 || m == 6 || m == 7) {
//             bottomEl.style.gridTemplateColumns = '';
//         } else {
//             bottomEl.style.gridTemplateColumns = '1fr 1fr';
//         }
//         if (m == 0) {
//             switchCopilotBtn.style.display = 'flex';
//         } else {
//             switchCopilotBtn.style.display = 'none';
//         }
//         if (m == 5) {
//             customStartBtn.style.display = 'flex';
//         } else {
//             customStartBtn.style.display = 'none';
//         }
//         if (m == 6) {
//             applyOneBtn.style.display = 'flex';
//         } else {
//             applyOneBtn.style.display = 'none';
//         }
//         if (m == 7) {
//             historyBtn.style.display = 'flex';
//         } else {
//             historyBtn.style.display = 'none';
//         }
//         if (m == 1 || m == 2) {
//             skipJobBtn.style.display = 'flex';
//         } else {
//             skipJobBtn.style.display = 'none';
//         }
//         if (m == 1) {
//             takeControlBtn.style.display = 'flex';
//         } else {
//             takeControlBtn.style.display = 'none';
//         }
//         if (m == 2) {
//             continueBtn.style.display = 'flex';
//         } else {
//             continueBtn.style.display = 'none';
//         }

//         if (m == 5 && agentStatus.search && !agentStatus.customStartWaiting) {
//             blockEl.append(bottomEl);
//             agentStatus.customStartWaiting = true;
//         }

//         if (m == 0 && agentStatus.search && agentStatus.customStartWaiting) {
//             blockEl.removeChild(bottomEl);
//             agentStatus.customStartWaiting = false;
//         }
//     }


//     for (let place of [classes.top, classes.right, classes.bottom, classes.left, classes.topLeft, classes.topRight, classes.bottomLeft, classes.bottomRight]) {
//         let resizerN = document.createElement('div');
//         resizerN.classList.add(classes.resizer, place);
//         blockEl.append(resizerN);
//     }

//     let listEl = document.createElement('div');
//     listEl.classList.add(classes.activityList);
//     listEl.style.padding = '8px 16px';
//     listWrapperEl.append(listEl);

//     let styleEl = document.createElement('style');

//     styleEl.innerHTML = `
    
//         #${STATUS_BLOCK_ELEMENT_ID} * {
//             margin: 0;
//             padding: 0;
//             font: normal 400 14px Arial;
//         }

//         #${STATUS_BLOCK_ELEMENT_ID} .${classes.activityListWrapper} {
//             background-image: url(data:image/svg+xml,%3Csvg%20width%3D%2214%22%20height%3D%2214%22%20viewBox%3D%220%200%2014%2014%22%20fill%3D%22none%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Ccircle%20cx%3D%227%22%20cy%3D%227%22%20r%3D%221%22%20fill%3D%22%23F0F0F0%22%2F%3E%3C%2Fsvg%3E);
//             background-repeat: repeat;
//         }
    
//         #${STATUS_BLOCK_ELEMENT_ID} .${classes.activityListWrapper}::-webkit-scrollbar {
//             width: 4px;
//             height: 4px;
//         }
        
//         #${STATUS_BLOCK_ELEMENT_ID} .${classes.activityListWrapper}::-webkit-scrollbar-track {
//             -webkit-border-radius: 2px;
//             border-radius: 2px;
//             background: #fafafa; 
//         }
        
//         #${STATUS_BLOCK_ELEMENT_ID} .${classes.activityListWrapper}::-webkit-scrollbar-thumb {
//             -webkit-border-radius: 2px;
//             border-radius: 2px;
//             background: #C3C3C7;
//         }
        
//         #${STATUS_BLOCK_ELEMENT_ID} .${classes.activityListWrapper}::-webkit-scrollbar-thumb:window-inactive {
//             background: #C3C3C7;
//         }
        
//         #${STATUS_BLOCK_ELEMENT_ID} .${classes.activityList} {
//             color: #0A102F;
//         }

//         #${STATUS_BLOCK_ELEMENT_ID} .${classes.resizer} {
//             position: absolute;
//             background: transparent;
//             z-index: 10;
//         }

//         #${STATUS_BLOCK_ELEMENT_ID} .${classes.top} {
//             top: -2px;
//             left: 0;
//             width: 100%;
//             height: 5px;
//             cursor: n-resize;
//         }

//         #${STATUS_BLOCK_ELEMENT_ID} .${classes.right} {
//             top: 0;
//             right: -2px;
//             width: 5px;
//             height: 100%;
//             cursor: e-resize;
//         }

//         #${STATUS_BLOCK_ELEMENT_ID} .${classes.bottom} {
//             bottom: -2px;
//             left: 0;
//             width: 100%;
//             height: 5px;
//             cursor: s-resize;
//         }

//         #${STATUS_BLOCK_ELEMENT_ID} .${classes.left} {
//             top: 0;
//             left: -2px;
//             width: 5px;
//             height: 100%;
//             cursor: w-resize;
//         }

//         #${STATUS_BLOCK_ELEMENT_ID} .${classes.topLeft} {
//             top: -2px;
//             left: -2px;
//             width: 10px;
//             height: 10px;
//             cursor: nw-resize;
//         }

//         #${STATUS_BLOCK_ELEMENT_ID} .${classes.topRight} {
//             top: -2px;
//             right: -2px;
//             width: 10px;
//             height: 10px;
//             cursor: ne-resize;
//         }

//         #${STATUS_BLOCK_ELEMENT_ID} .${classes.bottomLeft} {
//             bottom: -2px;
//             left: -2px;
//             width: 10px;
//             height: 10px;
//             cursor: sw-resize;
//         }

//         #${STATUS_BLOCK_ELEMENT_ID} .${classes.bottomRight} {
//             bottom: -2px;
//             right: -2px;
//             width: 10px;
//             height: 10px;
//             cursor: se-resize;
//         }
        
//     `;

//     document.head.append(styleEl);

//     document.body.append(blockEl);

//     function saveAgentGeometry() {
//         const { top, left, width, height } = blockEl.getBoundingClientRect();
//         const g = { top, left, width, height };
//         if (g.top < 0) {
//             blockEl.style.top = 0;
//         }
//         if (g.left < 0) {
//             blockEl.style.left = 0;
//         }
//         if (g.width < 375) {
//             blockEl.style.width = '375px';
//             g.width = 375;
//         }
//         if (g.height == 120) {
//             g.height = 48;
//         }
//         if (g.height < 48) {
//             blockEl.style.height = '48px';
//             g.height = 48;
//         }
//         if (g.left + g.width > window.innerWidth) {
//             blockEl.style.left = (window.innerWidth - g.width) + 'px';
//         }
//         if (g.top + g.height > window.innerHeight) {
//             blockEl.style.top = (window.innerHeight - g.height) + 'px';
//         }
//         if (agentStatus.windowStatus == 'normal') {
//             g.normalGeometry = {...g};
//             agentStatus.normalGeometry = g.normalGeometry;
//         } else {
//             g.normalGeometry = agentStatus.normalGeometry;
//         }
//         g.windowStatus = agentStatus.windowStatus;
//         chrome.runtime.sendMessage({
//             type: "SAVE-AGENT-GEOMETRY",
//             data: g
//         });
//         if (g.height < 120 && !agentStatus.search) {
//             blockEl.style.height = '120px';
//         }
//     }

//     const resizers = blockEl.querySelectorAll(`.${classes.resizer}`);
//     let isResizing = false;
//     let currentResizer;

//     resizers.forEach(resizer => {
//         resizer.addEventListener('mousedown', function (e) {
//             e.preventDefault();
//             isResizing = true;
//             currentResizer = resizer;
//             const rect = blockEl.getBoundingClientRect();

//             const startX = e.clientX;
//             const startY = e.clientY;
//             const startWidth = rect.width;
//             const startHeight = rect.height;
//             const startTop = rect.top;
//             const startLeft = rect.left;

//             function mouseMoveHandler(e) {
//                 if (!isResizing) return;

//                 const dx = e.clientX - startX;
//                 const dy = e.clientY - startY;

//                 if (currentResizer.classList.contains(classes.bottomRight)) {
//                     blockEl.style.width = startWidth + dx + 'px';
//                     blockEl.style.height = startHeight + dy + 'px';
//                 } else if (currentResizer.classList.contains(classes.bottomLeft)) {
//                     blockEl.style.width = startWidth - dx + 'px';
//                     blockEl.style.left = startLeft + dx + 'px';
//                     blockEl.style.height = startHeight + dy + 'px';
//                 } else if (currentResizer.classList.contains(classes.topRight)) {
//                     blockEl.style.width = startWidth + dx + 'px';
//                     blockEl.style.height = startHeight - dy + 'px';
//                     blockEl.style.top = startTop + dy + 'px';
//                 } else if (currentResizer.classList.contains(classes.topLeft)) {
//                     blockEl.style.width = startWidth - dx + 'px';
//                     blockEl.style.left = startLeft + dx + 'px';
//                     blockEl.style.height = startHeight - dy + 'px';
//                     blockEl.style.top = startTop + dy + 'px';
//                 } else if (currentResizer.classList.contains(classes.top)) {
//                     blockEl.style.height = startHeight - dy + 'px';
//                     blockEl.style.top = startTop + dy + 'px';
//                 } else if (currentResizer.classList.contains(classes.right)) {
//                     blockEl.style.width = startWidth + dx + 'px';
//                 } else if (currentResizer.classList.contains(classes.bottom)) {
//                     blockEl.style.height = startHeight + dy + 'px';
//                 } else if (currentResizer.classList.contains(classes.left)) {
//                     blockEl.style.width = startWidth - dx + 'px';
//                     blockEl.style.left = startLeft + dx + 'px';
//                 }
//             }

//             function mouseUpHandler() {
//                 isResizing = false;
//                 window.removeEventListener('mousemove', mouseMoveHandler);
//                 window.removeEventListener('mouseup', mouseUpHandler);
//                 saveAgentGeometry();
//             }

//             window.addEventListener('mousemove', mouseMoveHandler);
//             window.addEventListener('mouseup', mouseUpHandler);
//         });
//     });

//     let isDragging = false;
//     let offsetX = 0;
//     let offsetY = 0;

//     titleWrapperEl.addEventListener('mousedown', function (e) {
//         isDragging = true;
//         offsetX = e.clientX - blockEl.offsetLeft;
//         offsetY = e.clientY - blockEl.offsetTop;

//         function dragMouseMove(e) {
//             if (!isDragging) return;

//             blockEl.style.left = (e.clientX - offsetX) + 'px';
//             blockEl.style.top = (e.clientY - offsetY) + 'px';
//         }

//         function dragMouseUp() {
//             isDragging = false;
//             window.removeEventListener('mousemove', dragMouseMove);
//             window.removeEventListener('mouseup', dragMouseUp);
//             saveAgentGeometry();
//         }

//         window.addEventListener('mousemove', dragMouseMove);
//         window.addEventListener('mouseup', dragMouseUp);
//     });

//     minimizeBtn.addEventListener('click', function(e) {
//         if (agentStatus.windowStatus == 'normal') {
//             saveAgentGeometry();
//             agentStatus.windowStatus = 'minimized';
//             blockEl.style.height = '48px';
//             blockEl.style.width = '300px';
//             blockEl.style.left = '24px';
//             blockEl.style.top = (window.innerHeight - 48) + 'px';
//         } else {
//             agentStatus.windowStatus = 'normal';
//             if (!agentStatus.normalGeometry) {
//                 const { top, left, width, height } = blockEl.getBoundingClientRect();
//                 agentStatus.normalGeometry = { top, left, width, height };
//             }
//             if (agentStatus.normalGeometry.height < 300) {
//                 agentStatus.normalGeometry.height = 530;
//             }

//             blockEl.style.top = (agentStatus.normalGeometry?.top ?? 25) + 'px';
//             blockEl.style.left = (agentStatus.normalGeometry?.left ?? 25) + 'px';
//             blockEl.style.width = (agentStatus.normalGeometry?.width ?? 375) + 'px';
//             blockEl.style.height = (agentStatus.normalGeometry?.height ?? 530) + 'px';
//         }
//         saveAgentGeometry();
//     });

//     maximizeBtn.addEventListener('click', function(e) {
//         if (agentStatus.windowStatus == 'normal') {
//             saveAgentGeometry();
//             agentStatus.windowStatus = 'collapsed';
//             if (agentStatus.search) {
//                 blockEl.style.height = '48px';
//             } else {
//                 blockEl.style.height = '120px';
//             }
            
//         } else {
            
//             if (!agentStatus.normalGeometry) {
//                 const { top, left, width, height } = blockEl.getBoundingClientRect();
//                 agentStatus.normalGeometry = { top, left, width, height };
//             }
//             if (agentStatus.normalGeometry.height < 300) {
//                 agentStatus.normalGeometry.height = 530;
//             }

//             blockEl.style.height = (agentStatus.normalGeometry?.height ?? 530) + 'px';

//             if (agentStatus.windowStatus == 'minimized') {
//                 blockEl.style.top = (agentStatus.normalGeometry?.top ?? 25) + 'px';
//                 blockEl.style.left = (agentStatus.normalGeometry?.left ?? 25) + 'px';
//                 blockEl.style.width = (agentStatus.normalGeometry?.width ?? 375) + 'px';
//             }

//             agentStatus.windowStatus = 'normal';
//         }
//         saveAgentGeometry();
//     });

//     switchCopilotBtn.addEventListener('click', function(e) {
//         chrome.runtime.sendMessage({
//             type: "SET-COPILOT-MODE",
//         });
//         agentStatus.agentMode = 'Copilot';
//         if (agentStatus.readyToSubmit) {
//             agentStatus.setButtons(2);
//             agentStatus.paused = true;
//         } else {
//             agentStatus.setButtons(1);
//         }
//         appendStatusMessage('You’ve joined as Copilot. Choose what you’d like to do next ↙');
//     });

//     customStartBtn.addEventListener('click', function(e) {
//         agentStatus.paused = false;
//     });

//     applyOneBtn.addEventListener('click', function(e) {
//         agentStatus.applyOneWaiting = false;
//         agentStatus.setButtons(1);
//     });

//     historyBtn.addEventListener('click', function(e) {
//         window.open('https://app.liftmycv.com/#/history?url='+encodeURIComponent(agentStatus.historyAnchor));
//     });

//     takeControlBtn.addEventListener('click', function(e) {
//         agentStatus.setButtons(2);
//         agentStatus.paused = true;
//         appendStatusMessage('You’re in control now. Make any changes you’d like – then hit CONTINUE and I’ll handle the rest.');
//     });

//     continueBtn.addEventListener('click', function(e) {
//         agentStatus.setButtons(1);
//         agentStatus.paused = false;
//         agentStatus.resumed = true;
//         chrome.runtime.sendMessage({
//             type: "UNSET-COPILOT-MODE",
//         }).then((res) => {
//             if (res.type == 'SUCCESS') {
//                 appendStatusMessage('Switched to autopilot – continuing to apply on your behalf.');
//             }
//         });
        
//     });

//     skipJobBtn.addEventListener('click', async function(e) {
//         agentStatus.paused = true;

//         if (agentStatus.isApplyOne) {
//             closeAgent();
//             chrome.runtime.sendMessage({type: "STOP-APPLY-ONE"});
//             return;
//         }


//         chrome.runtime.sendMessage({
//             type: "UNSET-COPILOT-MODE",
//         });
        
//         const r = await chrome.runtime.sendMessage({type: "SEND-CV-TASK-ERROR", data: 'skipped by user'})

//         if (r.type == 'ERROR' && r.data == "limit reached") {
//             agentStatus.setButtons(2);
//             showSkipDisabledModal();
//         }
        
//     });

//     closeBtn.addEventListener('click', async function(e) {
//         if (!agentStatus.applyOneWaiting) {
//             if (!agentStatus.isApplyOne) {
//                 showCloseModal();
//             } else {
//                 agentStatus.paused = true;
//                 closeAgent();
//                 chrome.runtime.sendMessage({type: "STOP-APPLY-ONE"});
//             }
//         } else {
//             disableApplyOneModal();
//         }
//     });

//     if (agentMode == 'Copilot') {
//         agentStatus.setButtons(1);
//     }

    

//     if (!agentMessages || !agentMessages.length) {
//         if (agentMessages !== false) {
//             appendStatusMessage('Warming up your AI agent...');
//         }
//     } else {
//         for (let i = 0; i < agentMessages.length; i++) {
//             let msg = agentMessages[i];
//             msg.latest = (i === agentMessages.length - 1);
//             appendStatusMessage(msg.message, true, msg);
//         }        
//     }

//     window.addEventListener('resize', () => {
//         if (!agentStatus.makingScreenshot) {
//             saveAgentGeometry();
//         }
//     });

//     saveAgentGeometry();

// }

// async function customApplyWait(second) {
//     if (!second) {
//         appendStatusMessage('Waiting for you to set your job search filters and hit “START AUTO-APPLY” so I can start applying on your behalf.');
//     }
//     chrome.runtime.sendMessage({
//         type: "SET-COPILOT-MODE",
//     });
//     chrome.runtime.sendMessage({
//         type: "ENABLE-WRONG-RETURN",
//     });
//     agentStatus.setButtons(5);
    
//     agentStatus.paused = true;
//     agentStatus.setButtons(5);
//     while (agentStatus.paused) {
//         await wait(500);
//     }
//     agentStatus.setButtons(0);
//     chrome.runtime.sendMessage({
//         type: "UNSET-COPILOT-NOW",
//     });
// }

// async function challengeFound() {
//     appendStatusMessage('Hey! I’m stuck on a CAPTCHA. Can you help me out? Once it’s done – hit CONTINUE and I’ll keep going.');

    
//     agentStatus.setButtons(2);
//     agentStatus.paused = true;

//     chrome.runtime.sendMessage({type: "CAN-SKIP-CHALLENGE"}).then((res) => {
//         console.log(res);
//         if (res.type == 'SUCCESS') {
//             clearInterval(agentStatus.intervalId);
//             startCountDownInStatusBlock(120);
//             setTimeout(() => {
//                 chrome.runtime.sendMessage({type: "PLATFORM-SKIP-CHALLENGE"});
//             }, 120000);
//         } else {
//             chrome.runtime.sendMessage({
//                 type: "SET-COPILOT-MODE",
//             });
//             agentStatus.agentMode = 'Copilot';
//         }
//     });

//     await pause();
    
// }

// async function fillingErrors(e) {
//     await wait(1000);
//     if (agentStatus.success) {
//         return;
//     }
//     console.error('SEND CV ERROR', e);
//     sendErrorToServerFromPage(e);
//     if (agentStatus.agentMode == 'Copilot') {
//         appendStatusMessage(`Oops... I couldn’t auto-apply to this job. Some fields need your input. You can take over and fill them out manually – once you're done, hit CONTINUE and I’ll take care of the rest.`);
//         agentStatus.setButtons(2);
//         agentStatus.paused = true;
//     } else {
//         appendStatusMessage('Oops... I couldn’t auto-apply to this job – some fields or questions couldn’t be handled. If it’s an important one, you have 5 seconds to SWITCH TO COPILOT and take over manually.');
//         agentStatus.readyToSubmit = true;
//         await wait(12500);

//         if (agentStatus.agentMode != 'Copilot') {
//             await fullPageScreenshot();
//             chrome.runtime.sendMessage({type: "SEND-CV-TASK-ERROR", data: errorToString(e)}).catch((e) => {
//                 console.error(e)
//             });
//         }
//     }

//     if (agentStatus.agentMode == 'Copilot') {
//         await pause();
//         await wait(2000);
//         chrome.runtime.sendMessage({type: "SEND-CV-TASK-ERROR", data: errorToString(e) + ' skipped by user'}).catch((e) => {
//             console.error(e)
//         });
//         return;
//     }
// }

// function searchTaskDone() {
//     chrome.runtime.sendMessage({type: "GET-STATS"}).then((res) => {
//         if (res.data?.successfulSubmissions === 0 && res.data?.failedSubmissions === 0) {
//             appendStatusMessage('No relevant job openings found. Try adjusting your filters and restarting the auto-apply.');
//             setTimeout(() => {
//                 chrome.runtime.sendMessage({type: "SEARCH-TASK-DONE"});
//             }, 15000);
//         } else {
//             setTimeout(() => {
//                 chrome.runtime.sendMessage({type: "SEARCH-TASK-DONE"});
//             }, 5000);
//         }
//     });
// }

// async function pause() {
//     while (agentStatus.paused) {
//         await wait(500);
//     }
// }

// async function readyToSubmit() {
//     if (agentStatus.agentMode == 'Copilot') {
//         if (agentStatus.isApplyOne) {
//             appendStatusMessage(`I’ve filled in the fields for you. Feel free to make edits – or hit CONTINUE and I’ll submit the application.`);
//         } else {
//             appendStatusMessage(`I’ve filled in the fields for you. Feel free to make edits – or hit CONTINUE and I’ll submit the application and move to the next one.`);
//         }
//         agentStatus.setButtons(2);
//         agentStatus.paused = true;
//         await pause();
//         await wait(2000);
//     } else {
//         appendStatusMessage(`All done! Since you're in autopilot mode, I’ll submit this application in 5 seconds and move on – unless you SWITCH TO COPILOT to take control and make changes.`);
//         agentStatus.readyToSubmit = true;
//         await wait(9500);
//         if (agentStatus.agentMode == 'Copilot') {
//             await pause();
//             await wait(2000);
//             return;
//         }
//         appendStatusMessage(`No action taken. Submitting the application and moving on...`);
//         await wait(3000);
//         if (agentStatus.agentMode == 'Copilot') {
//             await pause();
//             await wait(2000);
//         }
//     }
// }


// function startCountDownInStatusBlock(duration, countDownEnded) {

//     //StatusMessage('Timer started');

//     let timer = duration;
//     let minutes;
//     let seconds;

//     function stop() {
//         timer = -1;
//     }

//     function addTime(duration) {
//         timer += duration;
//     }

//     let intervalId = agentStatus.intervalId = setInterval(function () {
//         if (agentStatus.agentMode == 'Copilot' && countDownEnded) {
//             document.querySelector(`.${classes.activityTimerValue}`).innerText = '';
//             document.querySelector(`.${classes.activityTimerLabel}`).innerText = 'Copilot is active';
//             clearInterval(intervalId);
//             return;
//         }
//         minutes = parseInt(timer / 60, 10)
//         seconds = parseInt(timer % 60, 10);

//         minutes = minutes < 10 ? "0" + minutes : minutes;
//         seconds = seconds < 10 ? "0" + seconds : seconds;

//         updateStatusTimer(minutes + ":" + seconds);

//         if (--timer < 0) {
//             clearInterval(intervalId);
//             if (typeof countDownEnded === 'function') {
//                 countDownEnded();
//             }
//             document.querySelector(`.${classes.activityTimerLabel}`).innerText = (agentStatus.agentMode == 'Copilot') ? 'Copilot is active': 'Autopilot is active';
//             document.querySelector(`.${classes.activityTimerValue}`).innerText = '';
//         }

//         if (timer % 10 === 0) {
//             chrome.runtime.sendMessage({ type: "APPLY-TAB-KEEPALIVE" });
//         }
//     }, 1000);

//     return {
//         stop,
//         addTime,
//     }

// }

// function updateStatusTimer(value) {
//     const element = document.querySelector(`.${classes.activityTimerValue}`);
//     if (!element) {
//         console.warn('timer element not found')
//     }
//     element.innerText = value;
//     document.querySelector(`.${classes.activityTimerLabel}`).innerText = 'Time left: ';
// }

// const agentStatus = {}

// function appendStatusMessage(statusMessage, repeat, dateTime) {

//     if (!document.getElementById(STATUS_BLOCK_ELEMENT_ID)) {
//         warmingUp();
//     }

//     let date = dateTime?.date ?? new Date().toLocaleDateString();
//     let time = dateTime?.time ?? new Date().toLocaleTimeString();

//     if (!repeat) {
//         chrome.runtime.sendMessage({
//             type: "AGENT-MESSAGE",
//             data: {message: statusMessage, date, time}
//         });
//     }

//     /*if (Date.now() - agentStatus.lastType < 500) {
//         setTimeout(() => { appendStatusMessage(statusMessage) }, 500);
//         console.log('message delayed', statusMessage);
//         return;
//     }*/

//     let currentMessageTimestamp = Date.now();
//     agentStatus.lastMessageTimestamp = agentStatus.lastType = currentMessageTimestamp;

    
//     if (date != agentStatus.lastDate) {
//         let timestampItemEl = document.createElement('p');
//         timestampItemEl.innerText = date;
//         timestampItemEl.style.color = '#6D717D';
//         timestampItemEl.style.fontSize = '11px';
//         timestampItemEl.style.textAlign = 'center';
//         timestampItemEl.style.marginBottom = '12px';
//         timestampItemEl.style.marginTop = '5px';

//         document.querySelector(`#${STATUS_BLOCK_ELEMENT_ID} .${classes.activityList}`).append(timestampItemEl);

//         agentStatus.lastDate = date;
//     }

//     let messageBlockEl = document.createElement('div');
//     messageBlockEl.style.display = 'flex';
//     let agentAvatarEl = document.createElement('div');
//     agentAvatarEl.innerHTML = `
//         <svg width="30" height="30" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <rect width="30" height="30" rx="15" fill="#A259FF"/>
//         <path fill-rule="evenodd" clip-rule="evenodd" d="M10.8332 7.2915C10.7181 7.2915 10.6248 7.38478 10.6248 7.49984C10.6248 7.6149 10.7181 7.70817 10.8332 7.70817C10.9482 7.70817 11.0415 7.6149 11.0415 7.49984C11.0415 7.38478 10.9482 7.2915 10.8332 7.2915ZM9.37484 7.49984C9.37484 6.69442 10.0278 6.0415 10.8332 6.0415C11.6386 6.0415 12.2915 6.69442 12.2915 7.49984C12.2915 8.08159 11.9509 8.58378 11.4582 8.81783V10.2536C12.0845 10.2081 12.8294 10.2082 13.7028 10.2082H16.2969C17.1703 10.2082 17.9151 10.2081 18.5415 10.2536V8.81783C18.0488 8.58378 17.7082 8.08159 17.7082 7.49984C17.7082 6.69442 18.3611 6.0415 19.1665 6.0415C19.9719 6.0415 20.6248 6.69442 20.6248 7.49984C20.6248 8.08159 20.2842 8.58378 19.7915 8.81783V10.4598C20.24 10.5958 20.633 10.8108 20.9669 11.1565C21.4647 11.6714 21.678 12.3176 21.7781 13.0873C21.8127 13.3536 21.8349 13.6458 21.8492 13.9655C22.3901 14.0087 22.9005 14.2429 23.287 14.6294C23.7167 15.0592 23.9582 15.642 23.9582 16.2498C23.9582 16.8576 23.7167 17.4405 23.287 17.8703C22.8932 18.2641 22.3709 18.4997 21.8187 18.5364C21.8075 18.6712 21.7941 18.8003 21.7781 18.9238C21.678 19.6936 21.4646 20.3397 20.9669 20.8549C20.5637 21.2723 20.0231 21.4913 19.4706 21.6147C19.4158 21.627 19.3713 21.637 19.3329 21.6461C19.3418 21.6986 19.3554 21.7578 19.3731 21.8268C19.3781 21.8463 19.3843 21.87 19.3911 21.8956C19.4059 21.9517 19.4232 22.0172 19.4352 22.0688C19.4351 22.0686 19.4352 22.0689 19.4352 22.0688C19.4935 22.3181 19.5398 22.566 19.5471 22.7906C19.554 23.0053 19.5296 23.2971 19.3463 23.5496C19.1428 23.83 18.8432 23.931 18.5808 23.9528C18.3337 23.9733 18.0623 23.9307 17.7898 23.8649C17.3077 23.7485 16.8525 23.4581 16.4814 23.1655C16.1004 22.865 15.7552 22.5194 15.4914 22.232C15.2703 21.9915 15.1657 21.911 15.0818 21.8703C15.009 21.835 14.8967 21.8032 14.604 21.8032H13.7028C12.5645 21.8032 11.6445 21.8032 10.9206 21.7025C10.1667 21.5977 9.53345 21.3731 9.03304 20.8551C8.53509 20.3402 8.3217 19.6939 8.22162 18.9241C8.20555 18.8005 8.19215 18.6713 8.18098 18.5364C7.62877 18.4997 7.10648 18.264 6.71272 17.8703C6.28295 17.4405 6.0415 16.8576 6.0415 16.2498C6.0415 15.642 6.28295 15.0592 6.71272 14.6294C7.09926 14.2428 7.60967 14.0086 8.15066 13.9654C8.16499 13.6458 8.18728 13.3535 8.22194 13.0872C8.32213 12.3174 8.5355 11.6713 9.0328 11.1565C9.36665 10.8108 9.75965 10.5958 10.2082 10.4598V8.81783C9.71547 8.58378 9.37484 8.08159 9.37484 7.49984ZM8.12583 15.229C7.92682 15.2694 7.74234 15.3675 7.5966 15.5133C7.40125 15.7086 7.2915 15.9736 7.2915 16.2498C7.2915 16.5261 7.40125 16.7911 7.5966 16.9864C7.7433 17.1331 7.92926 17.2315 8.12978 17.2715C8.12483 16.8956 8.12483 16.489 8.12484 16.0503L8.12484 15.9685C8.12483 15.711 8.12483 15.4646 8.12583 15.229ZM21.8699 17.2715C22.0704 17.2315 22.2564 17.1331 22.4031 16.9864C22.5984 16.7911 22.7082 16.5261 22.7082 16.2498C22.7082 15.9736 22.5984 15.7086 22.4031 15.5133C22.2573 15.3675 22.0729 15.2695 21.8739 15.229C21.8748 15.4624 21.8748 15.7063 21.8748 15.9611V16.0503C21.8748 16.489 21.8748 16.8956 21.8699 17.2715ZM19.1665 7.2915C19.0514 7.2915 18.9582 7.38478 18.9582 7.49984C18.9582 7.6149 19.0514 7.70817 19.1665 7.70817C19.2816 7.70817 19.3748 7.6149 19.3748 7.49984C19.3748 7.38478 19.2816 7.2915 19.1665 7.2915ZM11.0928 11.5469C10.4852 11.6314 10.1631 11.7855 9.93188 12.0249C9.69751 12.2675 9.54463 12.6098 9.46148 13.2485C9.37629 13.9031 9.37484 14.7695 9.37484 16.0057C9.37484 17.2419 9.37608 18.1083 9.46118 18.7629C9.54422 19.4016 9.69708 19.7436 9.93163 19.9862C10.1628 20.2256 10.4852 20.3799 11.0928 20.4644C11.7206 20.5518 12.5532 20.5532 13.7498 20.5532H14.604C14.9713 20.5532 15.3052 20.5893 15.6275 20.7457C15.9386 20.8966 16.1777 21.1315 16.4116 21.386C16.6502 21.646 16.9457 21.9398 17.2554 22.184C17.5751 22.4361 17.8612 22.5962 18.0832 22.6498C18.161 22.6686 18.2277 22.6821 18.2844 22.6914C18.272 22.6037 18.2506 22.4927 18.218 22.3531C18.2145 22.3382 18.2076 22.312 18.1988 22.2788C18.1696 22.168 18.1184 21.9737 18.0947 21.8192C18.0633 21.6152 18.0306 21.2389 18.2502 20.9068L18.251 20.9055C18.3873 20.7004 18.5686 20.5877 18.7427 20.5194C18.8787 20.4661 19.0388 20.4304 19.1718 20.4007C19.1804 20.3987 19.189 20.3968 19.1974 20.395C19.6298 20.2984 19.9028 20.1573 20.0678 19.9864C20.3026 19.7433 20.4555 19.4011 20.5385 18.7626C20.6236 18.1081 20.6248 17.2419 20.6248 16.0057C20.6248 14.7694 20.6236 13.903 20.5385 13.2484C20.4555 12.6097 20.3026 12.2677 20.068 12.0251C19.8368 11.7858 19.5145 11.6314 18.9069 11.5469C18.2791 11.4596 17.4464 11.4582 16.2498 11.4582H13.7498C12.5532 11.4582 11.7206 11.4596 11.0928 11.5469ZM11.8748 14.1665C11.8748 13.8213 12.1547 13.5415 12.4998 13.5415H12.5073C12.8525 13.5415 13.1323 13.8213 13.1323 14.1665C13.1323 14.5117 12.8525 14.7915 12.5073 14.7915H12.4998C12.1547 14.7915 11.8748 14.5117 11.8748 14.1665ZM16.8748 14.1665C16.8748 13.8213 17.1547 13.5415 17.4998 13.5415H17.5073C17.8525 13.5415 18.1323 13.8213 18.1323 14.1665C18.1323 14.5117 17.8525 14.7915 17.5073 14.7915H17.4998C17.1547 14.7915 16.8748 14.5117 16.8748 14.1665ZM12.4887 17.0442C12.7403 16.8079 13.1358 16.8204 13.3721 17.072C13.7166 17.4389 14.3018 17.7082 14.9998 17.7082C15.6979 17.7082 16.2831 17.4389 16.6276 17.072C16.8638 16.8204 17.2594 16.8079 17.511 17.0442C17.7626 17.2805 17.7751 17.676 17.5388 17.9277C16.9333 18.5725 16.0051 18.9582 14.9998 18.9582C13.9945 18.9582 13.0664 18.5725 12.4609 17.9277C12.2246 17.676 12.237 17.2805 12.4887 17.0442Z" fill="white"/>
//         </svg>
//     `;
//     messageBlockEl.append(agentAvatarEl);
//     let tailEl = document.createElement('div');
//     tailEl.innerHTML = `
//         <svg width="17" height="21" viewBox="0 0 17 21" fill="none" xmlns="http://www.w3.org/2000/svg">
//         <path d="M0.141092 0.0123558C5.52794 0.0123863 11.8875 -0.39653 12.5007 3.50018C10.7828 7.59665 21.029 17.9551 14.029 17.9555C12.4104 17.9555 11.3859 22.1833 5.49902 19.0001C5.47781 17.7133 5.14109 13.2711 5.14109 12.5128C5.14109 2.01275 -0.999401 0.0123863 0.141092 0.0123558Z" fill="#F0F0F0"/>
//         </svg>
//     `;
//     messageBlockEl.append(tailEl);

//     let messageItemEl = document.createElement('p');
//     messageItemEl.style.backgroundColor = '#F0F0F2';
//     messageItemEl.style.color = '#000000';
//     messageItemEl.style.borderTopRightRadius = '18px';
//     messageItemEl.style.borderBottomLeftRadius = '18px';
//     messageItemEl.style.borderBottomRightRadius = '18px';
//     messageItemEl.style.padding = '6px 18px';
//     messageItemEl.style.position = 'relative';
//     messageItemEl.style.left = '-12px';
//     messageItemEl.style.fontSize = '15px';
//     messageItemEl.style.marginBottom = '5px';
//     messageBlockEl.append(messageItemEl);
//     messageBlockEl.scrollIntoView();

//     let ellipsis = false;
//     if (statusMessage.trim().endsWith('...')) {
//         ellipsis = true;
//         statusMessage = statusMessage.trim().slice(0, -3);
//     }

//     let timestampItemEl = document.createElement('p');
    
//     timestampItemEl.innerText = time;
//     timestampItemEl.style.color = '#6D717D';
//     timestampItemEl.style.fontSize = '11px';
//     timestampItemEl.style.marginLeft = '50px';
//     timestampItemEl.style.marginBottom = '12px';
//     timestampItemEl.style.visibility = 'hidden';

//     document.querySelector(`#${STATUS_BLOCK_ELEMENT_ID} .${classes.activityList}`).append(messageBlockEl);
//     document.querySelector(`#${STATUS_BLOCK_ELEMENT_ID} .${classes.activityList}`).append(timestampItemEl);
//     if (time != agentStatus.lastTime) {
//         agentStatus.lastTime = time;
//     }

//     let l = 0;
//     let oldHeight = 0;

//     if (repeat) {
//         messageItemEl.innerText = statusMessage;
//         l = statusMessage.length;
//         timestampItemEl.style.visibility = 'visible';
//         timestampItemEl.scrollIntoView();
//     }

//     if (repeat && dateTime && !dateTime.latest) {
//         return;
//     }

//     const typewriter = setInterval(() => {
//         if (!repeat) {
//             l++;
//             if (agentStatus.lastMessageTimestamp != currentMessageTimestamp) {
//                 l = statusMessage.length;
//             }
            
//             let newHeidht = messageItemEl.getBoundingClientRect().height;

//             if (oldHeight != newHeidht) {
//                 messageBlockEl.scrollIntoView();
//                 oldHeight = newHeidht;
//             }
//             messageItemEl.innerText = statusMessage.substr(0, l);
//         }
//         if (l >= statusMessage.length) {
//             clearInterval(typewriter);

//             if (!repeat) {
//                 timestampItemEl.style.visibility = 'visible';
//             }

//             timestampItemEl.scrollIntoView();

//             if (ellipsis) {
//                 let ell = 3;
//                 const ellipsisAnimation = setInterval(() => {
//                     if (agentStatus.lastMessageTimestamp != currentMessageTimestamp) {
//                         clearInterval(ellipsisAnimation);
//                     } else {
//                         if (ell == 3) {
//                             ell = 0;
//                         } else {
//                             ell++;
//                         }
//                         messageItemEl.innerText = statusMessage + '.'.repeat(ell);
//                     }
//                 }, 300)
//             }
//         }
//         agentStatus.lastType = Date.now();
//     }, 25);




// }

// function appendStatusErrorMessage(errorMessage) {
//     appendStatusMessage(errorToString(errorMessage));
// }

// function formatWorkplace(str) {
//     if (!str) return '';
//     return str[0] + str.slice(1).toLowerCase();
//   }
  

// function loadVacancyFieldsValue(fields) {
//     return new Promise((resolve, reject) => {
//         chrome.runtime.sendMessage({
//             type: "GET-VACANCY-FIELDS-VALUES",
//             data: {
//                 url: window.location.href,
//                 fields: fields.map(({ element, ...other }) => other)
//             }
//         }).then(async (response) => {
//             console.log(response)
//             if (response.type !== 'SUCCESS') {
//                 reject(response.data);
//                 return;
//             }
//             resolve(
//                 response.data.reduce((acc, curr) => {
//                     acc[curr.fieldName] = Array.isArray(curr.value) ? curr.value[0] : curr.value;
//                     return acc;
//                 }, {})
//             );
//         }).catch(reason => {
//             reject(reason);
//         });
//     });
// }

// async function getResume(data) {
//     try {
//         if (data.session.resumePerJob) {
//             await pause();
//             appendStatusMessage('Generating an optimized resume for this job...');
//             const response = await chrome.runtime.sendMessage({type: "RESUME-PER-JOB", data: {originalUrl: window.location.href,}});
//             if (response.type != 'SUCCESS') {
//                 throw new Error('Failed to generate resume: ' + response.data);
//             }

//             const resumeUrl = response.data;
//             const url = new URL(resumeUrl);
//             const pathParts = url.pathname.split("/");
//             const encodedFileName = pathParts[pathParts.length - 1];
//             const originalFilename = decodeURIComponent(encodedFileName.split("?")[0]);
//             return {url, originalFilename, resumePerJob: true}
//         } else {
//             return data.profile.cv;
//         }
//     } catch (e) {
//         console.error('Error generating resume:', e);
//         appendStatusMessage('Resume per job is not generated, using default resume');
//         return data.profile.cv;
//     } 
// }

// function sendErrorToServerFromPage(e) {
//     chrome.runtime.sendMessage({
//         type: "SEND-ERROR-TO-SERVER",
//         data: {
//             url: window.location.href,
//             details: errorToString(e)
//         }
//     }).catch((reason) => {
//         console.error(reason);
//     });
// }

// async function cvTaskDone() {
//     agentStatus.success = true;
//     chrome.runtime.sendMessage({type: "SEND-CV-TASK-DONE"});
//     if (agentStatus.isApplyOne) {
//         appendStatusMessage('Success! Application submitted.');
//         agentStatus.removeButtons();
//     }
// }

// function successOnSelector(selector, interval = 100) {
//     const checkInterval = setInterval(() => {

//             if (document.querySelectorAll(selector).length > 0) {
//                 cvTaskDone();
//                 clearInterval(checkInterval);
//             }

//         }, interval);

//     return checkInterval;
// }

// function successOnSelectorAndSubString(selector, sub, interval = 100) {
//     const checkInterval = setInterval(() => {

//             if (document.querySelector(selector)?.innerText.includes(sub)) {
//                 cvTaskDone();
//                 clearInterval(checkInterval);
//             }

//         }, interval);

//     return checkInterval;
// }

// function successOnURL(suburl, interval = 100) {
//     const checkInterval = setInterval(() => {

//         if (location.href.includes(suburl)) {
//             cvTaskDone();
//             clearInterval(checkInterval);   
//         }

//     }, interval);
//     return checkInterval;
// }

// function waitForSuccess(selector, timeout = 15000, interval = 100) {
//     return new Promise((resolve, reject) => {
//         const startTime = Date.now();

//         const checkInterval = setInterval(() => {

//             if (document.querySelectorAll(selector).length > 0) {
//                 clearInterval(checkInterval);
//                 resolve(true);
//             }

//             if (Date.now() - startTime > timeout) {
//                 clearInterval(checkInterval);
//                 reject(new Error(`Could not find the element '${selector}' within the given time`));
//             }
//         }, interval);
//     });
// }

// function waitForURLUpdate(suburl, timeout = 15000, interval = 100) {
//     return new Promise((resolve, reject) => {
//         const startTime = Date.now();

//         const checkInterval = setInterval(() => {

//             if (location.href.includes(suburl)) {
//                 clearInterval(checkInterval);
//                 resolve(true);
//             }

//             if (Date.now() - startTime > timeout) {
//                 clearInterval(checkInterval);
//                 reject(new Error(`Could not find '${suburl}' in url within the given time`));
//             }
//         }, interval);
//     });
// }

// function waitForURLUpdateArray(suburls, timeout = 15000, interval = 100) {
//     if (!Array.isArray(suburls)) {
//         throw new Error("suburls is not array");
//     }

//     return new Promise((resolve, reject) => {
//         const startTime = Date.now();

//         const checkInterval = setInterval(() => {

//             const found = suburls.some(suburl => location.href.includes(suburl));

//             if (found) {
//                 clearInterval(checkInterval);
//                 resolve(true);
//             }

//             if (Date.now() - startTime > timeout) {
//                 clearInterval(checkInterval);
//                 reject(new Error(`Could not find any of '${suburls.join(", ")}' in URL within the given time`));
//             }
//         }, interval);
//     });
// }

// function waitForClickableButton(selector, timeout = 15000, interval = 100) {
//     return new Promise((resolve, reject) => {
//         const startTime = Date.now();

//         const checkInterval = setInterval(() => {
//             const button = document.querySelector(selector);

//             if (button) {
//                 const style = window.getComputedStyle(button);

//                 if (!button.disabled && style.visibility !== 'hidden' && style.pointerEvents !== 'none') {
//                     clearInterval(checkInterval);
//                     resolve(button); // Button is found and clickable
//                 }
//             }

//             if (Date.now() - startTime > timeout) {
//                 clearInterval(checkInterval);
//                 let reason = 'Button not found.';
//                 if (button) {
//                     if (button.disabled) {
//                         reason = 'Button found but it is disabled.';
//                     } else if (window.getComputedStyle(button).visibility === 'hidden') {
//                         reason = 'Button found but it is hidden (visibility: hidden).';
//                     } else if (window.getComputedStyle(button).pointerEvents === 'none') {
//                         reason = 'Button found but pointer events are disabled (pointer-events: none).';
//                     }
//                 }
//                 reject(new Error(`Could not find a clickable button '${selector}' within the given time. Reason: ${reason}`));
//             }
//         }, interval);
//     });
// }

// function extractWildcardAndDomain(url) {
//     const match = url.match(/^([a-zA-Z]+):\/\/(\*)\.(.+)$/);
//     return match ? { wildcard: match[2], domain: match[3] } : null;
// }

// function textareaGrow() {
//     try {
//         document.querySelectorAll('textarea').forEach(textarea => {
//             const prevHeight = textarea.offsetHeight;
//             const newHeight = textarea.scrollHeight;
//             if (newHeight > prevHeight) {
//                 textarea.style.height = (newHeight + 16) + 'px';
//             }
//         });
//     } catch {
//         console.warn('textareaGrow error');
//     }
// }

// async function fullPageScreenshot() {
//     textareaGrow();
//     agentStatus.makingScreenshot = true;
//     const blockEl = document.getElementById(STATUS_BLOCK_ELEMENT_ID);
//     if (blockEl) {
//         blockEl.style.display = 'none';
//     }

//     await Promise.race([
//         chrome.runtime.sendMessage({ type: "FULL-PAGE-SCREENSHOT" }),
//         new Promise((resolve) => setTimeout(resolve, 9000))
//     ]);

//     if (blockEl) {
//         blockEl.style.display = 'flex';
//     }
//     agentStatus.makingScreenshot = false;
// }

// async function linkedinModalScreenshot() {
//     textareaGrow();
//     agentStatus.makingScreenshot = true;
//     const blockEl = document.getElementById(STATUS_BLOCK_ELEMENT_ID);
//     if (blockEl) {
//         blockEl.style.display = 'none';
//     }

//     await Promise.race([
//         chrome.runtime.sendMessage({ type: "LINKEDIN-MODAL-SCREENSHOT" }),
//         new Promise((resolve) => setTimeout(resolve, 9000))
//     ]);

//     if (blockEl) {
//         blockEl.style.display = 'flex';
//     }
//     agentStatus.makingScreenshot = false;
// }

// function closeAgent() {
//     const blockEl = document.getElementById(STATUS_BLOCK_ELEMENT_ID);
//     if (blockEl) {
//         blockEl.style.display = 'none';
//     }
//     agentStatus.closed = true;
// }

// function movingOn(data) {
//     if (data.status !== 'ERROR') {
//         return appendStatusMessage('Success! Application submitted.\n\nNow moving to the next jobs and continuing the auto-apply...');
//     }

//     if (data.message.includes('skipped by user')) {
//         return appendStatusMessage('Roger that! Skipping this job and moving on...');
//     }

//     if (data.message.includes('workplace type')) {
//         return appendStatusMessage('This job doesn’t match your search criteria due to employment type. Skipping and moving on.');
//     }

//     if (data.message.includes('country') || data.message.includes('city') ) {
//         return appendStatusMessage('This job doesn’t match your search criteria due to location (country or city). Skipping and moving on.');
//     }

//     if (data.message.includes('No submit button') || data.message.includes('Job not found') || data.message.includes('Not job url')) {
//         return appendStatusMessage('Looks like this job has been removed or no longer exists. Skipping and continuing to the next one.');
//     }

//     if (data.message.includes('Files required')) {
//         return appendStatusMessage('This job asks for extra details or attachments I can’t process. Skipping and moving on.');
//     }

//     if (data.message.includes('Easy apply button not found')) {
//         return appendStatusMessage('‘Easy Apply’ button not found. Skipping and moving on.');
//     }

//     if (data.message.includes('Apply button is external link, skipped') || data.message.includes('Redirect to unsupported domain occurred')) {
//         return appendStatusMessage('‘This job redirected me away from the supported source, so I’m unable to handle it. Skipping and moving on.');
//     }

//     if (data.message.includes('ignored company')) {
//         return appendStatusMessage('This company in your ignore list. Skipping and moving on.');
//     }

//     if (data.message.includes('match score')) {
//         return appendStatusMessage('This job doesn’t match your search criteria due to low AI match score. Skipping and moving on.');
//     }

//     if (data.message.includes('SKIP')) {
//         appendStatusMessage('This job doesn’t match your profile or preferences. Skipping and moving on to the next one.');
//     } else {
//         appendStatusMessage('Hmm... I couldn’t auto-apply to the previous job due to an unexpected issue. Getting back to the search to find more relevant openings...');
//     }
// }

// async function prepareURL(url, isSearch, allowRedirect) {
//     const submittedLinks = (await chrome.runtime.sendMessage({ type: "GET-SUBMITTED-LINKS" })).data.filter(link => link.status == 'SUCCESS');
    
//     const u = new URL(url);

//     if (!u.hostname.includes('glassdoor') && !u.hostname.includes('monster')) {
//         url = normalizeUrl(url);
//     }

//     const currentUrl = url;

//     if (/^https:\/\/jobs\.(eu\.)?lever\.co\/([^\/]*)\/([^\/]*)\/?(.*)?$/.test(url)) {
//         url = url.replace(/\/apply$/, "");
//     }

//     if (/^https:\/\/apply\.workable\.com\/([^\/]*)\/([^\/]*)\/([^\/]*)\/?(.*\/)?$/.test(url)) {
//         url = url.replace(/\/apply\/$/, "");
//     }

//     if (/^https:\/\/[^.]+\.recruitee\.com\/o\/.+$/.test(url)) {
//         url = url.replace(/\/c\/new$/, "");
//     }

//     if (/^https:\/\/jobs\.ashbyhq\.com\/[^\/]+\/.+$/.test(url)) {
//         url = url.replace(/\/application$/, "");
//     }

//     if (/^https:\/\/[^.]+\.breezy\.hr\/p\/.+$/.test(url)) {
//         url = url.replace(/\/apply$/, "");
//     }

//     if (currentUrl != url) {
//         agentStatus.redirectToDescription = url;
//     }

//     if (url.startsWith('https://www.linkedin.com/jobs/view/')) {
//         url = url.replace(/^(https:\/\/www\.linkedin\.com\/jobs\/view\/\d+)(\/.*)?$/, '$1/');
//     }

//     if (url.startsWith('https://www.linkedin.com/jobs/search')) {
//         if (u.searchParams?.get('currentJobId')) {
//             url = 'https://www.linkedin.com/jobs/view/' + u.searchParams?.get('currentJobId') + '/';
//         } else {
//             return null;
//         }
//     }

//     if (url.startsWith('https://www.linkedin.com/authwall')) {
//         return null;
//     }

//     if (url.startsWith('https://www.linkedin.com/my-items/saved-jobs')) {
//         return null;
//     }

//     if (u.hostname.includes('monster') && isSearch) {
//         const href = document.querySelector('.card-selected a[data-testid=jobTitle]')?.href;
//         if (href) {
//             url = href;
//         }
//     }

//     if (u.hostname.includes('glassdoor')) {
//         if (isSearch) {
//             const href = document.querySelector('[data-test="job-card-wrapper"][data-selected="true"] [data-test="job-link"]')?.href;
//             if (href) {
//                 url = href;
//             }
//         }
//     }

//     if (url.startsWith('https://wellfound.com/jobs')) {
//         if (u.searchParams?.get('job_listing_slug')) {
//             url = 'https://wellfound.com/jobs/' + u.searchParams?.get('job_listing_slug');
//         } else {
//             return null;
//         }
//     }

//     if (url.startsWith('https://smartapply.indeed.com/') || url.startsWith("https://www.monster.com/jobs/apply-complete") || url.startsWith("https://www.monster.com/profile/apply") || url.startsWith("https://www.monster.com/apply") || url.startsWith("https://www.monster.ca/jobs/apply-complete") || url.startsWith("https://www.monster.ca/profile/apply") || url.startsWith("https://www.monster.ca/apply")) {
//         const historyDetails = await chrome.runtime.sendMessage({ type: "GET-HISTORY-DETAILS"});
//         if (historyDetails?.type == 'SUCCESS' && historyDetails?.data?.url) {
//             url = historyDetails.data.url;
//         }
//     }

//     if (u.hostname.includes('glassdoor') || u.hostname == 'smartapply.indeed.com') {
//         let jobListingId;
//         try {
//             const params = new URL(url).searchParams;
//             jobListingId = 'jobListingId=' + params.get('jobListingId');
//         } catch {
//             console.log('Error parsing URL:', url);
//             jobListingId = url;
//         }

//         if (submittedLinks.some(link => link.url.includes('glassdoor') && link.url.includes(jobListingId))) {
//             console.log('LINK', url, 'ALREADY SUBMITTED');
//             agentStatus.historyAnchor = url;
//             return false;
//         }
//     } else {
//         if (submittedLinks.some(link => link.url === url || url.includes(link.url))) {
//             console.log('LINK', url, 'ALREADY SUBMITTED');
//             agentStatus.historyAnchor = url;
//             return false;
//         }
//     }

//     if (url.startsWith('https://www.linkedin.com/')) {
//         if (!document.querySelector('.jobs-apply-button--top-card .jobs-apply-button')) {
//             return null;
//         }

//         if (document.querySelector('.jobs-apply-button--top-card .jobs-apply-button use[href="#link-external-small"]')) {
//             return null;
//         }
//     }

//     if (u.hostname.includes('monster') && isSearch) {
//         if (!document.querySelector('#job-view-header [data-testid="quick-apply-button"]')) {
//             return null;
//         }
//     }

//     if (u.hostname.includes('glassdoor')) {
//         if (!document.querySelector('[data-test="easyApply"]')) {
//             return null;
//         }
//     }

//     try {
//         if (u.hostname.includes('monster') && isSearch) {
//             company = document.querySelector('[data-testid=svx-job-view-wrapper] [data-testid=company]')?.innerText?.trim();
//             role = document.querySelector('[data-testid=svx-job-view-wrapper] [data-testid=jobTitle]')?.innerText?.trim();
//             description = document.querySelector('[data-testid=svx-job-view-wrapper] [data-testid=svx-description-container-inner]')?.innerText?.trim();
//             chrome.runtime.sendMessage({type: "SET-HISTORY-DETAILS", data: {company, role, description, url, quick: true}});
//         }
//         if (u.hostname.includes('glassdoor')) {
//             company = document.querySelector('div[class^=EmployerProfile_employerNameHeading]')?.innerText;
//             role = document.querySelector('h1')?.innerText;
//             description = document.querySelector('div[class^=JobDetails_jobDescription]')?.innerText;
//             chrome.runtime.sendMessage({type: "SET-HISTORY-DETAILS", data: {company, role, description, url, quick: true}})
//         }
//     } catch (e) {
//         console.error('Error set history:', e);
//     }

//     return url;
// }

// function canApplyHere() {
//     if (location.hostname.endsWith('lever.co') && document.title.startsWith('Not found')) {
//         return false;
//     }
//     if (location.hostname == 'apply.workable.com' && location.search.includes('not_found=true')) {
//         return false;
//     }
//     if (location.hostname.endsWith('recruitee.com') && document.querySelector('h2')?.innerText == 'We couldn’t find this job') {
//         return false;
//     }
//     if (location.hostname == 'jobs.ashbyhq.com' && document.querySelector('h1')?.innerText == 'Job not found') {
//         return false;
//     }
//     if (location.hostname.endsWith('breezy.hr') && (location.pathname.length < 10 || document.querySelector('h1')?.innerText == 'Position Closed')) {
//         return false;
//     }
//     return true;
// }

// async function startApplyOne(value, isSearch) {
//     try {
//         await wait(500);
//         const {type, data, message} = value;

//         if (type == "SUCCESS") {
//             return value;
//         }

//         if (!data?.applyOneEnabled) {
//             return {type: "ERROR", message: 'Apply one is not enabled.'};
//         }

//         try {
//             if (!canApplyHere()) {
//                 if (agentStatus.alreadyWarmed) {
//                     closeAgent();
//                 }
//                 return {type: "ERROR", message: 'You can’t apply here, this is not a job page.'};
//             }
//         } catch (e) {
//             console.error('Error checking if can apply here:', e);
//         }

//         let url = location.href;
//         let already = false;

//         try {
//             url = await prepareURL(url, isSearch)
//             if (url === false) {
//                 already = true;
//             } else {
//                 if (!url) {
//                     if (agentStatus.alreadyWarmed) {
//                         closeAgent();
//                     }
//                     return {type: "ERROR", message: 'This url is not supported.'};
//                 }
//             }
//         } catch (e) {
//             console.error('Error prepare URL:', e);
//         }

//         let tab = isSearch ? "new" : "current";        

//         agentStatus.applyOneWaiting = true;
//         warmingUp(data.agentGeometry, false, 'Copilot');

//         if (already) {
//             if (!document.referrer?.startsWith('https://app.liftmycv.com/')) {
//                 appendStatusMessage("Looks like I’ve already applied to this job earlier. Check your Auto-Apply History for more details.");
//                 agentStatus.applyOneWelcome = false;
//                 agentStatus.setButtons(7);
//             } else {
//                 if (agentStatus.alreadyWarmed) {
//                     closeAgent();
//                 }
//             }
//             return {type: "ERROR", message: 'This job is already submitted.'};
//         }

//         if (!agentStatus.applyOneWelcome) {
//             appendStatusMessage("Looks like you're on a site where I can assist with auto-applying. Hit the button and I’ll auto-fill the application for you.");
//             agentStatus.applyOneWelcome = true;
//         }
//         agentStatus.setButtons(6);
//         let ts = Date.now();
//         agentStatus.applyOneTs = ts
//         while (agentStatus.applyOneWaiting) {
//             await wait(500);
//         }
//         if (ts != agentStatus.applyOneTs) {
//             return {type: "ERROR", message: 'Non-current'};
//         }

//         url = location.href;

//         try {
//             url = await prepareURL(url, isSearch)
//             if (!url) {
//                 return await startApplyOne(value, isSearch);
//             }
//         } catch (e) {
//             console.error('Error prepare URL:', e);
//         }

//         if (tab == "current") {
//             appendStatusMessage('Warming up your AI agent...');
//         }

//         const u = new URL(url);
//         if (location.hostname.includes('glassdoor')) {
//             tab = "new-double";
//         }

//         let profile;
//         for (let t = 0; t < 2; t++) {
//             const result = await chrome.runtime.sendMessage({type: "START-APPLY-ONE", data: {tab, url}});
//             profile = result.data;
//             if (result.type == "SUCCESS" || t > 0) { break; }
//             await chrome.runtime.sendMessage({type: "RELOGIN-START"});

//             for (let u = 0; true; u++) {
//                 if (u == 5) {
//                     appendStatusMessage('You are not logged in to LiftmyCV. Please log in to continue.');
//                     await wait(2500);
//                     chrome.runtime.sendMessage({type: "RELOGIN-FOCUS"});
//                 }
//                 const completed = await chrome.runtime.sendMessage({type: "RELOGIN-IS-COMPLETED"});
//                 if (completed.type == "SUCCESS") {
//                     appendStatusMessage('Login confirmed.');
//                     break;
//                 }
//                 await wait(1000);
//             }
//         }

//         if (!profile) {
//             appendStatusMessage('Failed to get your profile data. Please try again.');
//             chrome.runtime.sendMessage({type: "STOP-APPLY-ONE"});
//             return await startApplyOne(value, isSearch);
//         }

//         if (profile.completenessScore <= 30) {
//             appendStatusMessage('It looks like you’re trying to activate AI auto-apply with an incomplete profile. Please complete your profile first.');
//             await wait(5000);
//             chrome.runtime.sendMessage({type: "GO-TO-PROFILE"});
//             chrome.runtime.sendMessage({type: "STOP-APPLY-ONE"});
//             return await startApplyOne(value, isSearch);
//         }

//         if (profile.completenessScore < 50) {
//             appendStatusMessage('It looks like you’re trying to activate AI auto-apply with an incomplete profile. Your profile data is used to fill out job applications accurately, so we recommend completing it first. You can still continue, but the success rate may be lower.')
//             await wait(7000);
//         }

//         const stats = await chrome.runtime.sendMessage({type: 'POPUP-STATS-GET'});
//         if (stats?.type == "SUCCESS") {
//             if (Number(stats.data.liftsLeft) <= 0) {
//                 liftsOut();
//                 chrome.runtime.sendMessage({type: "STOP-APPLY-ONE"});
//                 return await startApplyOne(value, isSearch);
//             } 
//         }
        
//         agentStatus.isApplyOne = true;

//         if (agentStatus.redirectToDescription) {
//             location.assign(agentStatus.redirectToDescription);
//             return {type: "ERROR", message: 'Redirecting to job description...'};
//         }

//         if (tab == "current" || (u.hostname.includes('glassdoor') && !isSearch)) {
//             if (location.hostname == 'apply.workable.com') {
//                 location.reload();
//                 return {type: "ERROR", message: 'Reloading page to apply...'};
//             } else {
//                 value = await chrome.runtime.sendMessage({type: "GET-SEND-CV-TASK"});
//                 return value;
//             }
//         } else {
//             if (u.hostname.includes('monster') && isSearch) {
//                 chrome.runtime.sendMessage({type: "CLICK-N-BUTTON", data: {selector1: '#job-view-header', n: 0, selector2: '[data-testid="quick-apply-button"]'}});
//             } else {
//                 chrome.runtime.sendMessage({type: "APPLY-ONE-OPEN-NEW-TAB"});
//             }
//             return await startApplyOne(value, isSearch);
//         }
        

//     } catch (e) {
//         console.error(e);
//         sendErrorToServerFromPage(e);
//     }
// }





let countDown;


async function grabFields() {
    const results = [];
    for (const label of [...document.querySelectorAll('div[data-test="JobApplication-Modal"] form label.block')]) {

        const result = {
            element: null,
            type: '',
            label: label.firstChild.innerText.trim(),
            required: false
        };

        if (result.label.endsWith('*')) {
            result.label = result.label.slice(0, -1).trim();
            result.required = true;
        }

        if (result.label.startsWith('What interests you about working')) {
            result.label = 'Cover letter - ' + result.label;
        }

        const container = label.children[1];
        if (!container) { continue; }

        if (container.querySelector('input[type=radio]')) {
            result.type = 'radio';
            result.element = [...container.querySelectorAll('input[type=radio]')];
            result.options = result.element.map(input => input.parentElement.querySelector('label').innerText);
        } else if (label.querySelector('input[type=checkbox]')) {
            result.type = 'checkbox';
            result.element = [...label.querySelectorAll('input[type=checkbox]')];
            result.options = result.element.map(input => input.parentElement.querySelector('label').innerText);
        } else if (container.querySelector('.select__control')) {
            result.type = 'select';
            result.element = container.querySelector('.select__control');
            if (!container.querySelector('.select__menu .select__option')) {
                result.element.querySelector('input').dispatchEvent(new Event('mousedown', {bubbles: true}));
                result.element.querySelector('input').dispatchEvent(new Event('focusin', {bubbles: true}));
                await wait(1000);
            }

            result.options = [ ...container.querySelectorAll('.select__menu .select__option') ].map(input => input.innerText.trim());
            result.element.querySelector('input').dispatchEvent(new Event('focusout', {bubbles: true}));
        } else {
            result.element = container.firstChild;
            result.type = result.element.type;
        }

        
        if (result.element && result.type) {
            results.push(result);
        }

    }


    const cover = document.getElementById('form-input--userNote');
    if (cover) {
        results.push({
            element: cover,
            type: cover.type,
            label: 'Cover letter - ' + cover.placeholder,
            required: true
        });
    }

    return results;
}

function scrollToElement(container, element) {
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const offset = elementRect.top - containerRect.top;
  
    container.scrollTop += offset;

    const scrollEvent = new Event('scroll', {
        bubbles: true,
        cancelable: true,
    });
    
    container.dispatchEvent(scrollEvent);
};

async function uploadCv(cv) {
    await pause();
    const fileInput = document.querySelector('div[data-test="JobApplication-Modal"] form input[type=file]');
    if (fileInput) {
        appendStatusMessage('Uploading your CV. Please hang on...');
        await uploadFile(cv.url, cv.originalFilename, fileInput);
    }

}

async function fillFields(fields, result) {
    await pause();

    appendStatusMessage('Filling in the application fields. Almost done – please wait a bit...');

    for (const field of fields) {
        await pause();
        await new Promise(resolve => {
            setTimeout(async () => {

                try {
                    scrollToElement(document.querySelector('.ReactModal__Content'), field.element);
                } catch {}

                try {

                    const value = result[field.label];

                    console.log(field, field.label, value)

                    if (!value && value !== 0) {
                        if (field.required && Array.isArray(field.element) && field.element[0]) {
                            field.element[0].click()
                        }
                        console.log('skip')
                        resolve();
                        return;
                    }

                    if (Array.isArray(field.element)) {
                        if (agentStatus.resumed) {
                            field.element.forEach((el) => {
                                if (el.checked) {
                                    throw new Error('filled by user')
                                }
                            });
                        }
                        field.element.forEach((el) => {
                            if ((el.id && el.parentElement.querySelector('label').innerText || el.value) === value) {
                                el.click();
                            }
                        });
                    } else if (field.type === 'select') {
                        if (agentStatus.resumed && field.element.querySelector('.select__value-container--has-value')) {
                            throw new Error('filled by user')
                        }

                        const container = field.element.parentElement;
                        if (!container.querySelector('.select__menu .select__option')) {
                            field.element.querySelector('input').dispatchEvent(new Event('mousedown', {bubbles: true}));
                            field.element.querySelector('input').dispatchEvent(new Event('focusin', {bubbles: true}));
                            await wait(1000);
                        }

                        [...container.querySelectorAll('.select__menu .select__option')].forEach((el) => {
                            if (el.innerText.trim() === value) {
                                el.click();
                            }
                        });

                        await wait(1000);
                        field.element.querySelector('input').dispatchEvent(new Event('focusout', {bubbles: true}));
                    } else {
                        if (agentStatus.resumed && field.element.value) {
                            throw new Error('filled by user')
                        }
                        setNativeValue(field.element, value);
                        //field.element.dispatchEvent(new Event('focusout', {bubbles: true}));
                    }

                } catch (e) {
                    console.error(e);
                    sendErrorToServerFromPage(e);
                }

                resolve();

            }, 3000);
        });

    }

}


async function apply(data) {

    const {devMode, profile} = data;

    try {
        await waitForSuccess('button[class*=styles_applyButton]:not([disabled])');
    } catch {
        throw new SendCvSkipError('Easy apply button not found');
    }

    document.querySelector('button[class*=styles_applyButton]')?.click();

    await waitForSuccess('div[data-test="JobApplication-Modal"]');
    await waitForSuccess('button[data-test=JobApplicationModal--SubmitButton]');

    if (document.querySelector('button[data-test=JobApplicationModal--SubmitButton]')?.disabled) {
        await wait(3000);
        throw new SendCvSkipError('Submit button disabled');
    }

    company = document.title.split(' • ')[0].split(' at ') [1];
    role = document.title.split(' • ')[0].split(' at ') [0];
    description = document.querySelector('div[class^=styles_description]')?.innerText;

    if (data.session.platform != 'WELLFOUND_BOOKMARKS') {
        setTimeout(() => !["OFF", "Broad match", "Exact match"].includes(data.session.searchAccuracy) && appendStatusMessage('Scanning job description and matching it with your profile...'), 3000);
    }
    const r = await chrome.runtime.sendMessage({type: "SET-HISTORY-DETAILS", data: {company, role, description}}).catch((e) => {
        console.error(e)
    });
    if (r.data) {
        appendStatusMessage(`AI match score: ${r.data}%`);
    }

    await wait(2000);
    await pause();

    await uploadCv(await getResume(data));

    appendStatusMessage('Collecting fields and application questions...');

    const fields = await grabFields();

    await pause();
    await wait(3000);

    appendStatusMessage('Sending the fields to the server for processing...');

    setTimeout(() => {
        appendStatusMessage('Waiting for server response to begin filling out the application. This may take a moment – please hang tight...');
    }, 5000);

    successOnSelectorAndSubString('button[class*=styles_applyButton][disabled]', 'Applied');

    const result = await loadVacancyFieldsValue(fields);

    console.log(result);

    countDown.addTime(60);

    await fillFields(fields, result);

    if (!devMode) {
        await readyToSubmit();
        await linkedinModalScreenshot();
        document.querySelector('button[data-test=JobApplicationModal--SubmitButton]')?.click();
        await waitForSuccess('button[class*=styles_applyButton][disabled]');
    }

}

window.addEventListener('load', () => {

    

    chrome.runtime.sendMessage({type: "GET-SEND-CV-TASK"}).then(async (value) => {

        value = await startApplyOne(value);

        const {type, data, message} = value;

        switch (type) {
            case 'ERROR':
                
                
                break;
            case 'SUCCESS':
                try {

                    warmingUp(data.agentGeometry, data.agentMessages, data.agentMode);

                    countDown = startCountDownInStatusBlock(60 * 5, () => {
                        chrome.runtime.sendMessage({
                            type: "SEND-CV-TAB-TIMER-ENDED", data: {
                                url: window.location.href
                            }
                        });
                    });

                    await new Promise((resolve, reject) => {
                        setTimeout(async () => {
                            try {
                                await apply(data);
                                resolve();
                            } catch (e) {
                                reject(e);
                            }
                        }, 3000);
                    });


                } catch (e) {
                    if (e instanceof SendCvSkipError) {
                        
                        chrome.runtime.sendMessage({type: "SEND-CV-TASK-SKIP", data: e.message});
                    } else {
                        await fillingErrors(e);
                    }
                }
                break;
        }

    });

});
