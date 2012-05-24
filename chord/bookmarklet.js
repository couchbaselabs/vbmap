var clusterInfo = {
    cluster: "bookmarklet",
    bucket: "default"
};

function initialize() {
   var imgdim = Math.round((window.innerWidth / 2) - 20);

   var chord = makeChord(imgdim, imgdim, '#chord').fill('grey');

   function updateGraphs(json) {
     chord(json);
     $("#loading").hide();
   }

    doMapRequest(clusterInfo, updateGraphs);

    setInterval(function() {
        doMapRequest(clusterInfo, updateGraphs);
    }, 2000);
}

InjectionController.onConnected = initialize;
InjectionController.init();
