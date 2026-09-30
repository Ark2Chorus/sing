const SINGER_DATA = {"VOWELS":{"IY":[[270,2290,3010,3400,4200]],"IH":[[390,1990,2550,3300,4100]],"EH":[[530,1840,2480,3300,4000]],"AE":[[660,1720,2410,3300,3900]],"AA":[[730,1090,2440,3300,3900]],"AO":[[570,840,2410,3300,3900]],"UH":[[440,1020,2240,3200,3900]],"UW":[[300,870,2240,3200,3900]],"AH":[[640,1190,2390,3300,3900]],"ER":[[490,1350,1690,3300,3900]],"EY":[[480,1720,2520,3300,4000],[330,2200,2900,3400,4100]],"AY":[[730,1090,2440,3300,3900],[400,1900,2550,3300,4100]],"OY":[[570,840,2410,3300,3900],[400,1900,2550,3300,4100]],"AW":[[730,1090,2440,3300,3900],[400,940,2240,3200,3900]],"OW":[[500,900,2400,3300,3900],[330,870,2240,3200,3900]]},"VOWEL_BW":[70,95,140,200,260],"SCHWA":[500,1500,2500,3300,3900],"CONSONANTS":{"M":{"cls":"nasal","voiced":true,"fmt":[250,1100,2100,3000,3800],"bw":[120,180,250,300,360],"gain":0.42,"dur":0.07},"N":{"cls":"nasal","voiced":true,"fmt":[250,1700,2600,3200,3900],"bw":[120,180,250,300,360],"gain":0.42,"dur":0.065},"NG":{"cls":"nasal","voiced":true,"fmt":[250,2300,2750,3300,3900],"bw":[120,180,250,300,360],"gain":0.4,"dur":0.075},"L":{"cls":"liquid","voiced":true,"fmt":[360,1300,2700,3300,3900],"bw":[90,110,170,220,280],"gain":0.8,"dur":0.06},"R":{"cls":"liquid","voiced":true,"fmt":[310,1060,1380,3300,3900],"bw":[90,110,170,220,280],"gain":0.8,"dur":0.06},"W":{"cls":"glide","voiced":true,"fmt":[290,610,2150,3200,3900],"bw":[90,110,170,220,280],"gain":0.75,"dur":0.055},"Y":{"cls":"glide","voiced":true,"fmt":[260,2070,3020,3400,4100],"bw":[90,110,170,220,280],"gain":0.75,"dur":0.05},"S":{"cls":"fricative","voiced":false,"fmt":[320,1400,2540,3300,3900],"bw":[200,260,320,380,440],"gain":0.6,"noise":[6200,2600,0.3],"dur":0.095},"SH":{"cls":"fricative","voiced":false,"fmt":[330,1800,2400,3300,3900],"bw":[200,260,320,380,440],"gain":0.6,"noise":[3000,1700,0.34],"dur":0.1},"F":{"cls":"fricative","voiced":false,"fmt":[340,1100,2080,3300,3900],"bw":[200,260,320,380,440],"gain":0.6,"noise":[4800,3400,0.13],"dur":0.085},"TH":{"cls":"fricative","voiced":false,"fmt":[320,1290,2540,3300,3900],"bw":[200,260,320,380,440],"gain":0.6,"noise":[5800,3200,0.1],"dur":0.08},"HH":{"cls":"aspirate","voiced":false,"fmt":null,"bw":[200,260,320,380,440],"gain":0.6,"noise":[1400,2600,0.16],"dur":0.07},"Z":{"cls":"fricative","voiced":true,"fmt":[320,1400,2540,3300,3900],"bw":[200,260,320,380,440],"gain":0.45,"noise":[6000,2600,0.17],"dur":0.08},"ZH":{"cls":"fricative","voiced":true,"fmt":[330,1800,2400,3300,3900],"bw":[200,260,320,380,440],"gain":0.45,"noise":[3000,1700,0.19],"dur":0.085},"V":{"cls":"fricative","voiced":true,"fmt":[340,1100,2080,3300,3900],"bw":[200,260,320,380,440],"gain":0.5,"noise":[4600,3200,0.08],"dur":0.07},"DH":{"cls":"fricative","voiced":true,"fmt":[320,1290,2540,3300,3900],"bw":[200,260,320,380,440],"gain":0.5,"noise":[5600,3000,0.06],"dur":0.065},"P":{"cls":"stop","voiced":false,"fmt":[300,900,2100,3300,3900],"bw":[120,160,220,280,340],"gain":0.6,"noise":[900,1200,0.22],"closure":0.045,"burst":0.012,"aspir":0.045},"T":{"cls":"stop","voiced":false,"fmt":[300,1700,2600,3300,3900],"bw":[120,160,220,280,340],"gain":0.6,"noise":[4000,2400,0.26],"closure":0.045,"burst":0.01,"aspir":0.04},"K":{"cls":"stop","voiced":false,"fmt":[300,1900,2500,3300,3900],"bw":[120,160,220,280,340],"gain":0.6,"noise":[2400,1800,0.24],"closure":0.05,"burst":0.014,"aspir":0.05},"B":{"cls":"stop","voiced":true,"fmt":[250,900,2100,3300,3900],"bw":[120,160,220,280,340],"gain":0.25,"noise":[800,1100,0.11],"closure":0.04,"burst":0.008,"aspir":0.0},"D":{"cls":"stop","voiced":true,"fmt":[250,1700,2600,3300,3900],"bw":[120,160,220,280,340],"gain":0.25,"noise":[3600,2200,0.13],"closure":0.04,"burst":0.008,"aspir":0.0},"G":{"cls":"stop","voiced":true,"fmt":[250,1900,2500,3300,3900],"bw":[120,160,220,280,340],"gain":0.25,"noise":[2200,1600,0.12],"closure":0.045,"burst":0.01,"aspir":0.0},"CH":{"cls":"affricate","voiced":false,"fmt":[330,1800,2400,3300,3900],"bw":[200,260,320,380,440],"gain":0.6,"noise":[3000,1700,0.32],"closure":0.045,"burst":0.01,"fric":0.075},"JH":{"cls":"affricate","voiced":true,"fmt":[330,1800,2400,3300,3900],"bw":[200,260,320,380,440],"gain":0.4,"noise":[3000,1700,0.2],"closure":0.038,"burst":0.008,"fric":0.06}},"VOICES":{"soprano":{"scale":1.18,"singer_hz":3200,"singer_db":6.5,"breath":0.03,"oq":0.58,"vib_hz":4.9,"vib_cents":34,"range":[60,84]},"mezzo":{"scale":1.13,"singer_hz":3050,"singer_db":7.0,"breath":0.028,"oq":0.56,"vib_hz":4.8,"vib_cents":33,"range":[57,79]},"alto":{"scale":1.09,"singer_hz":2950,"singer_db":7.0,"breath":0.03,"oq":0.55,"vib_hz":4.8,"vib_cents":32,"range":[53,76]},"countertenor":{"scale":1.05,"singer_hz":2900,"singer_db":7.5,"breath":0.026,"oq":0.55,"vib_hz":5.4,"vib_cents":32,"warmth_add":5.0,"air_add":4.0,"air_mul":1.5,"fric_mul":1.1,"range":[55,79]},"tenor":{"scale":1.0,"singer_hz":2850,"singer_db":8.0,"breath":0.022,"oq":0.52,"vib_hz":5.7,"vib_cents":31,"tilt_mul":0.5,"warmth_add":9.0,"air_add":8.0,"air_mul":2.2,"fric_mul":1.3,"range":[48,72]},"baritone":{"scale":0.96,"singer_hz":2700,"singer_db":8.0,"breath":0.022,"oq":0.5,"vib_hz":5.9,"vib_cents":31,"tilt_mul":0.5,"warmth_add":10.0,"air_add":8.0,"air_mul":2.2,"fric_mul":1.3,"range":[45,67]},"bass":{"scale":0.92,"singer_hz":2550,"singer_db":7.5,"breath":0.024,"oq":0.48,"vib_hz":5.9,"vib_cents":30,"tilt_mul":0.5,"warmth_add":11.0,"air_add":8.0,"air_mul":2.2,"fric_mul":1.3,"range":[40,64]},"child":{"scale":1.32,"singer_hz":3500,"singer_db":4.0,"breath":0.038,"oq":0.62,"vib_hz":5.6,"vib_cents":18,"range":[60,81]}},"STYLES":{"pop":{"singer_db_mul":0.35,"vib_mul":0.75,"vib_delay":0.32,"breath_mul":1.35,"porta":0.055,"oq_add":0.04,"bright_lo":10.0,"bright_hi":13.0,"bright_air":13.0,"fric_gain":1.9,"ring_mix":0.45},"classical":{"singer_db_mul":1.0,"vib_mul":1.0,"vib_delay":0.22,"breath_mul":0.85,"porta":0.07,"oq_add":0.0,"bright_lo":9.0,"bright_hi":12.0,"bright_air":12.0,"fric_gain":1.7,"ring_mix":0.6},"choral":{"singer_db_mul":0.65,"vib_mul":0.9,"vib_delay":0.4,"breath_mul":1.45,"porta":0.06,"oq_add":0.02,"bright_lo":2.0,"bright_hi":-3.0,"bright_air":15.0,"warmth":5.0,"air_noise":0.02,"fric_gain":1.9,"ring_mix":0.1,"src_tilt":6.5,"src_tilt_mix":0.1,"src_tilt_floor":600},"musical":{"singer_db_mul":0.55,"vib_mul":0.85,"vib_delay":0.28,"breath_mul":1.15,"porta":0.06,"oq_add":0.02,"bright_lo":9.5,"bright_hi":12.5,"bright_air":12.5,"fric_gain":1.85,"ring_mix":0.5}},"LEXICON":{"a":["AH"],"the":["DH","AH"],"and":["AE","N","D"],"of":["AH","V"],"to":["T","UW"],"in":["IH","N"],"is":["IH","Z"],"it":["IH","T"],"that":["DH","AE","T"],"this":["DH","IH","S"],"these":["DH","IY","Z"],"those":["DH","OW","Z"],"was":["W","AH","Z"],"were":["W","ER"],"been":["B","IH","N"],"being":["B","IY","IH","NG"],"am":["AE","M"],"are":["AA","R"],"be":["B","IY"],"have":["HH","AE","V"],"has":["HH","AE","Z"],"had":["HH","AE","D"],"i":["AY"],"me":["M","IY"],"my":["M","AY"],"mine":["M","AY","N"],"myself":["M","AY","S","EH","L","F"],"you":["Y","UW"],"your":["Y","AO","R"],"yours":["Y","AO","R","Z"],"we":["W","IY"],"us":["AH","S"],"our":["AW","ER"],"ours":["AW","ER","Z"],"he":["HH","IY"],"him":["HH","IH","M"],"his":["HH","IH","Z"],"she":["SH","IY"],"her":["HH","ER"],"hers":["HH","ER","Z"],"they":["DH","EY"],"them":["DH","EH","M"],"their":["DH","EH","R"],"there":["DH","EH","R"],"here":["HH","IH","R"],"where":["W","EH","R"],"what":["W","AH","T"],"when":["W","EH","N"],"who":["HH","UW"],"whom":["HH","UW","M"],"whose":["HH","UW","Z"],"how":["HH","AW"],"why":["W","AY"],"which":["W","IH","CH"],"some":["S","AH","M"],"come":["K","AH","M"],"comes":["K","AH","M","Z"],"coming":["K","AH","M","IH","NG"],"become":["B","IH","K","AH","M"],"done":["D","AH","N"],"none":["N","AH","N"],"one":["W","AH","N"],"once":["W","AH","N","S"],"gone":["G","AO","N"],"son":["S","AH","N"],"sun":["S","AH","N"],"run":["R","AH","N"],"fun":["F","AH","N"],"love":["L","AH","V"],"loves":["L","AH","V","Z"],"loving":["L","AH","V","IH","NG"],"above":["AH","B","AH","V"],"dove":["D","AH","V"],"give":["G","IH","V"],"given":["G","IH","V","AH","N"],"live":["L","IH","V"],"lived":["L","IH","V","D"],"do":["D","UW"],"does":["D","AH","Z"],"doing":["D","UW","IH","NG"],"don't":["D","OW","N","T"],"won't":["W","OW","N","T"],"can't":["K","AE","N","T"],"cannot":["K","AE","N","AA","T"],"isn't":["IH","Z","AH","N","T"],"wasn't":["W","AA","Z","AH","N","T"],"aren't":["AA","R","N","T"],"i'm":["AY","M"],"i'll":["AY","L"],"i've":["AY","V"],"i'd":["AY","D"],"we'll":["W","IY","L"],"we've":["W","IY","V"],"we're":["W","IH","R"],"you'll":["Y","UW","L"],"you've":["Y","UW","V"],"you're":["Y","AO","R"],"they'll":["DH","EY","L"],"they're":["DH","EY","R"],"it's":["IH","T","S"],"that's":["DH","AE","T","S"],"let's":["L","EH","T","S"],"there's":["DH","EH","R","Z"],"here's":["HH","IH","R","Z"],"all":["AO","L"],"call":["K","AO","L"],"fall":["F","AO","L"],"small":["S","M","AO","L"],"tall":["T","AO","L"],"wall":["W","AO","L"],"walk":["W","AO","K"],"talk":["T","AO","K"],"always":["AO","L","W","EY","Z"],"also":["AO","L","S","OW"],"almost":["AO","L","M","OW","S","T"],"already":["AO","L","R","EH","D","IY"],"heart":["HH","AA","R","T"],"hearts":["HH","AA","R","T","S"],"earth":["ER","TH"],"heard":["HH","ER","D"],"learn":["L","ER","N"],"world":["W","ER","L","D"],"word":["W","ER","D"],"work":["W","ER","K"],"worth":["W","ER","TH"],"girl":["G","ER","L"],"bird":["B","ER","D"],"first":["F","ER","S","T"],"turn":["T","ER","N"],"burn":["B","ER","N"],"night":["N","AY","T"],"light":["L","AY","T"],"bright":["B","R","AY","T"],"right":["R","AY","T"],"sight":["S","AY","T"],"might":["M","AY","T"],"fight":["F","AY","T"],"high":["HH","AY"],"sigh":["S","AY"],"eye":["AY"],"eyes":["AY","Z"],"sky":["S","K","AY"],"fly":["F","L","AY"],"cry":["K","R","AY"],"try":["T","R","AY"],"by":["B","AY"],"buy":["B","AY"],"dry":["D","R","AY"],"shy":["SH","AY"],"tie":["T","AY"],"die":["D","AY"],"say":["S","EY"],"says":["S","EH","Z"],"said":["S","EH","D"],"day":["D","EY"],"way":["W","EY"],"away":["AH","W","EY"],"stay":["S","T","EY"],"play":["P","L","EY"],"pray":["P","R","EY"],"grey":["G","R","EY"],"great":["G","R","EY","T"],"break":["B","R","EY","K"],"steak":["S","T","EY","K"],"eight":["EY","T"],"take":["T","EY","K"],"make":["M","EY","K"],"name":["N","EY","M"],"same":["S","EY","M"],"came":["K","EY","M"],"face":["F","EY","S"],"grace":["G","R","EY","S"],"place":["P","L","EY","S"],"praise":["P","R","EY","Z"],"raise":["R","EY","Z"],"days":["D","EY","Z"],"ways":["W","EY","Z"],"soul":["S","OW","L"],"whole":["HH","OW","L"],"home":["HH","OW","M"],"alone":["AH","L","OW","N"],"know":["N","OW"],"known":["N","OW","N"],"no":["N","OW"],"so":["S","OW"],"go":["G","OW"],"goes":["G","OW","Z"],"show":["SH","OW"],"snow":["S","N","OW"],"grow":["G","R","OW"],"low":["L","OW"],"slow":["S","L","OW"],"throw":["TH","R","OW"],"though":["DH","OW"],"through":["TH","R","UW"],"thought":["TH","AO","T"],"brought":["B","R","AO","T"],"bought":["B","AO","T"],"caught":["K","AO","T"],"taught":["T","AO","T"],"ought":["AO","T"],"sought":["S","AO","T"],"now":["N","AW"],"down":["D","AW","N"],"town":["T","AW","N"],"found":["F","AW","N","D"],"sound":["S","AW","N","D"],"around":["ER","AW","N","D"],"ground":["G","R","AW","N","D"],"out":["AW","T"],"about":["AH","B","AW","T"],"shout":["SH","AW","T"],"doubt":["D","AW","T"],"hour":["AW","ER"],"power":["P","AW","ER"],"flower":["F","L","AW","ER"],"tower":["T","AW","ER"],"four":["F","AO","R"],"more":["M","AO","R"],"before":["B","IH","F","AO","R"],"door":["D","AO","R"],"floor":["F","L","AO","R"],"poor":["P","UH","R"],"sure":["SH","UH","R"],"pure":["P","Y","UH","R"],"truth":["T","R","UW","TH"],"true":["T","R","UW"],"new":["N","UW"],"few":["F","Y","UW"],"knew":["N","UW"],"blue":["B","L","UW"],"too":["T","UW"],"two":["T","UW"],"would":["W","UH","D"],"could":["K","UH","D"],"should":["SH","UH","D"],"good":["G","UH","D"],"stood":["S","T","UH","D"],"wood":["W","UH","D"],"look":["L","UH","K"],"book":["B","UH","K"],"took":["T","UH","K"],"foot":["F","UH","T"],"put":["P","UH","T"],"full":["F","UH","L"],"pull":["P","UH","L"],"push":["P","UH","SH"],"water":["W","AO","T","ER"],"father":["F","AA","DH","ER"],"mother":["M","AH","DH","ER"],"brother":["B","R","AH","DH","ER"],"other":["AH","DH","ER"],"another":["AH","N","AH","DH","ER"],"together":["T","AH","G","EH","DH","ER"],"weather":["W","EH","DH","ER"],"whether":["W","EH","DH","ER"],"feather":["F","EH","DH","ER"],"over":["OW","V","ER"],"ever":["EH","V","ER"],"never":["N","EH","V","ER"],"forever":["F","ER","EH","V","ER"],"every":["EH","V","R","IY"],"very":["V","EH","R","IY"],"because":["B","IH","K","AO","Z"],"beautiful":["B","Y","UW","T","AH","F","AH","L"],"beauty":["B","Y","UW","T","IY"],"believe":["B","IH","L","IY","V"],"heaven":["HH","EH","V","AH","N"],"seven":["S","EH","V","AH","N"],"open":["OW","P","AH","N"],"even":["IY","V","AH","N"],"listen":["L","IH","S","AH","N"],"often":["AO","F","AH","N"],"mountain":["M","AW","N","T","AH","N"],"fountain":["F","AW","N","T","AH","N"],"again":["AH","G","EH","N"],"against":["AH","G","EH","N","S","T"],"angel":["EY","N","JH","AH","L"],"danger":["D","EY","N","JH","ER"],"change":["CH","EY","N","JH"],"strange":["S","T","R","EY","N","JH"],"stranger":["S","T","R","EY","N","JH","ER"],"sing":["S","IH","NG"],"sings":["S","IH","NG","Z"],"singing":["S","IH","NG","IH","NG"],"song":["S","AO","NG"],"long":["L","AO","NG"],"along":["AH","L","AO","NG"],"strong":["S","T","R","AO","NG"],"wrong":["R","AO","NG"],"young":["Y","AH","NG"],"among":["AH","M","AH","NG"],"king":["K","IH","NG"],"bring":["B","R","IH","NG"],"ring":["R","IH","NG"],"thing":["TH","IH","NG"],"nothing":["N","AH","TH","IH","NG"],"something":["S","AH","M","TH","IH","NG"],"everything":["EH","V","R","IY","TH","IH","NG"],"morning":["M","AO","R","N","IH","NG"],"evening":["IY","V","N","IH","NG"],"holy":["HH","OW","L","IY"],"glory":["G","L","AO","R","IY"],"story":["S","T","AO","R","IY"],"lord":["L","AO","R","D"],"god":["G","AA","D"],"christ":["K","R","AY","S","T"],"jesus":["JH","IY","Z","AH","S"],"tongue":["T","AH","NG"],"equal":["IY","K","W","AH","L"],"air":["EH","R"],"habits":["HH","AE","B","IH","T","S"],"prayer":["P","R","EH","R"],"proclaim":["P","R","OW","K","L","EY","M"],"servant":["S","ER","V","AH","N","T"],"thanks":["TH","AE","NG","K","S"],"weakness":["W","IY","K","N","AH","S"],"gladness":["G","L","AE","D","N","AH","S"],"evermore":["EH","V","ER","M","AO","R"],"forevermore":["F","AO","R","EH","V","ER","M","AO","R"],"strength":["S","T","R","EH","NG","K","TH"],"strenght":["S","T","R","EH","NG","K","TH"],"dwells":["D","W","EH","L","Z"],"dweels":["D","W","EH","L","Z"],"instruments":["IH","N","S","T","R","AH","M","AH","N","T","S"],"insstruments":["IH","N","S","T","R","AH","M","AH","N","T","S"],"faith":["F","EY","TH"],"peace":["P","IY","S"],"please":["P","L","IY","Z"],"piece":["P","IY","S"],"free":["F","R","IY"],"tree":["T","R","IY"],"see":["S","IY"],"sea":["S","IY"],"key":["K","IY"],"dream":["D","R","IY","M"],"dreams":["D","R","IY","M","Z"],"seem":["S","IY","M"],"mean":["M","IY","N"],"teach":["T","IY","CH"],"reach":["R","IY","CH"],"each":["IY","CH"],"speak":["S","P","IY","K"],"feel":["F","IY","L"],"feeling":["F","IY","L","IH","NG"],"real":["R","IY","L"],"really":["R","IH","L","IY"],"year":["Y","IH","R"],"years":["Y","IH","R","Z"],"near":["N","IH","R"],"hear":["HH","IH","R"],"tear":["T","IH","R"],"dear":["D","IH","R"],"clear":["K","L","IH","R"],"fear":["F","IH","R"],"head":["HH","EH","D"],"dead":["D","EH","D"],"bread":["B","R","EH","D"],"death":["D","EH","TH"],"breath":["B","R","EH","TH"],"breathe":["B","R","IY","DH"],"enough":["IH","N","AH","F"],"tough":["T","AH","F"],"rough":["R","AH","F"],"laugh":["L","AE","F"],"half":["HH","AE","F"],"answer":["AE","N","S","ER"],"knee":["N","IY"],"knife":["N","AY","F"],"write":["R","AY","T"],"wrote":["R","OW","T"],"island":["AY","L","AH","N","D"],"people":["P","IY","P","AH","L"],"little":["L","IH","T","AH","L"],"able":["EY","B","AH","L"],"table":["T","EY","B","AH","L"],"simple":["S","IH","M","P","AH","L"],"temple":["T","EH","M","P","AH","L"],"circle":["S","ER","K","AH","L"],"gentle":["JH","EH","N","T","AH","L"],"candle":["K","AE","N","D","AH","L"],"middle":["M","IH","D","AH","L"],"purple":["P","ER","P","AH","L"],"double":["D","AH","B","AH","L"],"trouble":["T","R","AH","B","AH","L"],"whisper":["W","IH","S","P","ER"],"wonder":["W","AH","N","D","ER"],"wonderful":["W","AH","N","D","ER","F","AH","L"],"under":["AH","N","D","ER"],"number":["N","AH","M","B","ER"],"summer":["S","AH","M","ER"],"winter":["W","IH","N","T","ER"],"finger":["F","IH","NG","G","ER"],"longer":["L","AO","NG","G","ER"],"stronger":["S","T","R","AO","NG","G","ER"],"nature":["N","EY","CH","ER"],"future":["F","Y","UW","CH","ER"],"picture":["P","IH","K","CH","ER"],"creature":["K","R","IY","CH","ER"],"question":["K","W","EH","S","CH","AH","N"],"nation":["N","EY","SH","AH","N"],"station":["S","T","EY","SH","AH","N"],"motion":["M","OW","SH","AH","N"],"ocean":["OW","SH","AH","N"],"music":["M","Y","UW","Z","IH","K"],"moment":["M","OW","M","AH","N","T"],"promise":["P","R","AA","M","IH","S"],"forgive":["F","ER","G","IH","V"],"forget":["F","ER","G","EH","T"],"remember":["R","IH","M","EH","M","B","ER"],"tomorrow":["T","AH","M","AA","R","OW"],"sorrow":["S","AA","R","OW"],"follow":["F","AA","L","OW"],"window":["W","IH","N","D","OW"],"shadow":["SH","AE","D","OW"],"yellow":["Y","EH","L","OW"],"color":["K","AH","L","ER"],"warm":["W","AO","R","M"],"storm":["S","T","AO","R","M"],"born":["B","AO","R","N"],"star":["S","T","AA","R"],"stars":["S","T","AA","R","Z"],"far":["F","AA","R"],"car":["K","AA","R"],"arm":["AA","R","M"],"dark":["D","AA","R","K"],"part":["P","AA","R","T"],"start":["S","T","AA","R","T"],"apart":["AH","P","AA","R","T"],"fire":["F","AY","ER"],"desire":["D","IH","Z","AY","ER"],"higher":["HH","AY","ER"],"tired":["T","AY","ER","D"],"child":["CH","AY","L","D"],"children":["CH","IH","L","D","R","AH","N"],"mind":["M","AY","N","D"],"find":["F","AY","N","D"],"kind":["K","AY","N","D"],"behind":["B","IH","HH","AY","N","D"],"time":["T","AY","M"],"line":["L","AY","N"],"shine":["SH","AY","N"],"divine":["D","IH","V","AY","N"],"alive":["AH","L","AY","V"],"life":["L","AY","F"],"wife":["W","AY","F"],"white":["W","AY","T"],"while":["W","AY","L"],"smile":["S","M","AY","L"],"side":["S","AY","D"],"inside":["IH","N","S","AY","D"],"beside":["B","IH","S","AY","D"],"hide":["HH","AY","D"],"ride":["R","AY","D"],"wide":["W","AY","D"],"guide":["G","AY","D"],"tide":["T","AY","D"],"pride":["P","R","AY","D"],"bride":["B","R","AY","D"],"rise":["R","AY","Z"],"wise":["W","AY","Z"],"voice":["V","OY","S"],"choice":["CH","OY","S"],"joy":["JH","OY"],"boy":["B","OY"],"noise":["N","OY","Z"],"oh":["OW"],"ah":["AA"],"la":["L","AA"],"oo":["UW"],"ooh":["UW"],"mm":["M"],"hmm":["HH","M"],"yeah":["Y","EH"],"hey":["HH","EY"],"woah":["W","OW"],"na":["N","AA"],"doo":["D","UW"],"dum":["D","AH","M"],"loved":["L","AH","V","D"],"move":["M","UW","V"],"moved":["M","UW","V","D"],"moving":["M","UW","V","IH","NG"],"gives":["G","IH","V","Z"],"lives":["L","IH","V","Z"],"living":["L","IH","V","IH","NG"],"instrument":["IH","N","S","T","R","AH","M","AH","N","T"],"accord":["AH","K","AO","R","D"],"below":["B","IH","L","OW"],"offer":["AO","F","ER"],"trumpet":["T","R","AH","M","P","AH","T"],"cymbal":["S","IH","M","B","AH","L"],"tambourine":["T","AE","M","B","ER","IY","N"],"multitude":["M","AH","L","T","IH","T","UW","D"],"majesty":["M","AE","JH","AH","S","T","IY"],"almighty":["AO","L","M","AY","T","IY"],"anthem":["AE","N","TH","AH","M"],"ofer":["AO","F","ER"],"reains":["R","EY","N","Z"],"everlasting":["EH","V","ER","L","AE","S","T","IH","NG"],"goodness":["G","UH","D","N","AH","S"],"everlasttinggoodness":["EH","V","ER","L","AE","S","T","IH","NG","G","UH","D","N","AH","S"],"ghost":["G","OW","S","T"],"host":["HH","OW","S","T"],"most":["M","OW","S","T"],"post":["P","OW","S","T"],"with":["W","IH","DH"],"within":["W","IH","DH","IH","N"],"without":["W","IH","DH","AW","T"],"from":["F","R","AH","M"],"house":["HH","AW","S"],"into":["IH","N","T","UW"],"onto":["AA","N","T","UW"],"upon":["AH","P","AA","N"],"melody":["M","EH","L","AH","D","IY"],"gratitude":["G","R","AE","T","IH","T","UW","D"],"reign":["R","EY","N"],"ye":["Y","IY"],"thee":["DH","IY"],"thy":["DH","AY"],"thine":["DH","AY","N"],"thou":["DH","AW"],"amen":["AA","M","EH","N"],"alleluia":["AA","L","EH","L","UW","Y","AH"],"hallelujah":["HH","AA","L","EH","L","UW","Y","AH"],"powr":["P","AW","ER"],"resound":["R","IH","Z","AW","N","D"],"worship":["W","ER","SH","IH","P"],"heavenly":["HH","EH","V","AH","N","L","IY"],"heavnly":["HH","EH","V","AH","N","L","IY"],"glorious":["G","L","AO","R","IY","AH","S"],"spirit":["S","P","IH","R","IH","T"],"mercy":["M","ER","S","IY"],"mighty":["M","AY","T","IY"],"body":["B","AA","D","IY"],"study":["S","T","AH","D","IY"],"city":["S","IH","T","IY"],"any":["EH","N","IY"],"many":["M","EH","N","IY"],"money":["M","AH","N","IY"],"honey":["HH","AH","N","IY"],"happy":["HH","AE","P","IY"],"pretty":["P","R","IH","T","IY"],"sorry":["S","AA","R","IY"],"second":["S","EH","K","AH","N","D"],"better":["B","EH","T","ER"],"letter":["L","EH","T","ER"],"matter":["M","AE","T","ER"],"ready":["R","EH","D","IY"],"level":["L","EH","V","AH","L"],"eleven":["IH","L","EH","V","AH","N"]}};

// ===================== Ark2 AI Singer =======================================
// A formant singing voice for the mixer, ported from the Python engine in
// singing_ai/ (singing/phonemes.py, singing/g2p.py, singing/voice.py).
//
// Source-filter synthesis: a glottal pulse (the vocal folds) excites a bank of
// five resonators tuned to the formants of whatever phoneme is being sung,
// with a separate noise path for frication, stop bursts and breath.
//
// Two deliberate differences from the Python engine, both forced by Web Audio:
//   * The Python engine cascades five unity-gain resonators. Web Audio has no
//     such node, so this uses a PARALLEL bank of RBJ bandpass biquads
//     (BiquadFilterNode type='bandpass') with a Klatt-style amplitude falloff.
//     Verified offline: peaks land within 17 Hz of the same targets.
//   * Consonants can only be anticipated as far as Tone's lookahead allows,
//     so a long cluster right on a beat is clamped instead of starting early.

const SINGER_FORMANT_GAINS = [1.0, 0.63, 0.40, 0.25, 0.16];

// Two extra high poles, matching singing/voice.py. Five formants alone leave
// nothing above ~5 kHz, which measured 16 dB duller than a real choral
// recording. These are wide and low-Q: they restore the octave rather than
// adding an audible resonance of their own.
const SINGER_HIGH_POLES = [
  { hz: 4900, bw: 600, gain: 0.13 },
  { hz: 6300, bw: 1000, gain: 0.09 },
];

// ---------------------------------------------------------------- g2p ------

const SINGER_VOICED_TH = new Set(['the','this','that','these','those','they',
  'them','their','there','then','than','thus','though','thou','thee','thy',
  'thine','therefore','themselves','thence','thither']);

const SINGER_VOICELESS = new Set(['P','T','K','F','TH','S','SH','CH','HH']);
const SINGER_SIBILANT = new Set(['S','Z','SH','ZH','CH','JH']);

const SINGER_LEGAL_ONSETS = new Set([
  'S,T','S,P','S,K','S,L','S,M','S,N','S,W','T,R','D,R','P,R','B,R','K,R',
  'G,R','F,R','TH,R','SH,R','P,L','B,L','K,L','G,L','F,L','S,T,R','S,P,R',
  'S,K,R','S,P,L','K,W','HH,W','D,W','T,W','S,V','SH,T']);

const SINGER_VOWEL_LETTERS = new Set('aeiouy');
const SINGER_CONSONANT_LETTERS = new Set('bcdfghjklmnpqrstvwxz');

function singerIsVowel(p){ return Object.prototype.hasOwnProperty.call(SINGER_DATA.VOWELS, p); }

function singerMagicE(w, j){
  return /^[bcdfgklmnprstvz]e[sd]?$/.test(w.slice(j));
}
function singerOpenSyllable(w, i){
  return i + 2 < w.length
    && SINGER_CONSONANT_LETTERS.has(w[i+1])
    && !'wyr'.includes(w[i+1])
    && SINGER_VOWEL_LETTERS.has(w[i+2]);
}
function singerSilentE(w, i){
  const n = w.length;
  if (i + 1 >= n && n > 2) return true;
  const rest = w.slice(i+1);
  return (rest === 's' || rest === 'd') && n > 3 && i > 0
      && SINGER_CONSONANT_LETTERS.has(w[i-1]);
}

function singerAddPlural(phones){
  if (!phones.length) return phones;
  const last = phones[phones.length-1];
  if (SINGER_SIBILANT.has(last)) return phones.concat(['IH','Z']);
  if (SINGER_VOICELESS.has(last)) return phones.concat(['S']);
  return phones.concat(['Z']);
}

function singerFixInflections(w, phones){
  if (!phones.length) return phones;
  if (w.endsWith('ed') && w.length > 3){
    while (phones.length && ['EH','D','IY'].includes(phones[phones.length-1])) phones.pop();
    if (phones.length){
      const last = phones[phones.length-1];
      if (last === 'T' || last === 'D') phones.push('AH','D');
      else if (SINGER_VOICELESS.has(last)) phones.push('T');
      else phones.push('D');
    }
  } else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 2){
    if (phones.length && (phones[phones.length-1] === 'S' || phones[phones.length-1] === 'Z')) phones.pop();
    if (phones.length){
      const last = phones[phones.length-1];
      if (SINGER_SIBILANT.has(last)) phones.push('IH','Z');
      else if (SINGER_VOICELESS.has(last)) phones.push('S');
      else phones.push('Z');
    }
  }
  return phones.filter(p => singerIsVowel(p) || SINGER_DATA.CONSONANTS[p]);
}

function singerRules(w){
  const phones = [];
  let i = 0;
  const n = w.length;
  while (i < n){
    const ch = w[i];
    const nxt = i + 1 < n ? w[i+1] : '';
    const prev = i > 0 ? w[i-1] : '';
    const two = w.substr(i, 2), three = w.substr(i, 3), four = w.substr(i, 4);

    if (three === 'tch'){ phones.push('CH'); i += 3; }
    else if (three === 'dge'){ phones.push('JH'); i += 3; }
    else if (three === 'igh'){ phones.push('AY'); i += 3; }
    else if (four === 'ough'){ phones.push('AO'); i += 4; }
    else if (four === 'tion'){ phones.push('SH','AH','N'); i += 4; }
    else if (four === 'sion'){ phones.push('ZH','AH','N'); i += 4; }
    else if (two === 'ch'){ phones.push('CH'); i += 2; }
    else if (two === 'sh'){ phones.push('SH'); i += 2; }
    else if (two === 'th'){ phones.push((i === 0 && SINGER_VOICED_TH.has(w)) ? 'DH' : 'TH'); i += 2; }
    else if (two === 'ph'){ phones.push('F'); i += 2; }
    else if (two === 'wh'){ phones.push('W'); i += 2; }
    else if (two === 'ck'){ phones.push('K'); i += 2; }
    else if (two === 'ng' && (i + 2 >= n || w.slice(i+2) === 's')){ phones.push('NG'); i += 2; }
    else if (two === 'qu'){ phones.push('K','W'); i += 2; }
    else if (two === 'gh'){ if (i === 0) phones.push('G'); i += 2; }
    else if ((two === 'kn' || two === 'gn') && i === 0){ phones.push('N'); i += 2; }
    else if (two === 'wr' && i === 0){ phones.push('R'); i += 2; }
    else if (two === 'mb' && i + 2 >= n){ phones.push('M'); i += 2; }
    else if (two === 'le' && i + 2 >= n && i > 0 && SINGER_CONSONANT_LETTERS.has(prev)){
      phones.push('AH','L'); i += 2;
    }
    else if (ch === nxt && SINGER_CONSONANT_LETTERS.has(ch)){
      phones.push({c:'K',g:'G',s:'S',j:'JH',x:'K',h:'HH'}[ch] || ch.toUpperCase());
      i += 2;
    }
    else if ('aeiou'.includes(ch) && nxt === 'r'
             && (i + 2 >= n || !SINGER_VOWEL_LETTERS.has(w[i+2]))){
      if (ch === 'a'){ phones.push('AA','R'); }
      else if (ch === 'o'){ phones.push('AO','R'); }
      else { phones.push('ER'); }
      i += 2;
    }
    else if (two === 'ai' || two === 'ay'){ phones.push('EY'); i += 2; }
    else if (two === 'ee' || two === 'ea'){ phones.push('IY'); i += 2; }
    else if (two === 'ie' || two === 'ei'){ phones.push('IY'); i += 2; }
    else if (two === 'oa' || two === 'oe' || two === 'ow'){ phones.push('OW'); i += 2; }
    else if (two === 'oi' || two === 'oy'){ phones.push('OY'); i += 2; }
    else if (two === 'ou'){ phones.push('AW'); i += 2; }
    else if (two === 'oo'){ phones.push('UW'); i += 2; }
    else if (two === 'au' || two === 'aw'){ phones.push('AO'); i += 2; }
    else if (two === 'ue' || two === 'ui' || two === 'ew'){ phones.push('UW'); i += 2; }
    else if (ch === 'a'){
      if (i + 1 >= n) phones.push('AH');
      else if (i === 0 && singerOpenSyllable(w, i)) phones.push('AH');
      else if (singerMagicE(w, i+1) || singerOpenSyllable(w, i)) phones.push('EY');
      else phones.push('AE');
      i += 1;
    }
    else if (ch === 'e'){
      if (!singerSilentE(w, i)) phones.push(singerMagicE(w, i+1) ? 'IY' : 'EH');
      i += 1;
    }
    else if (ch === 'i'){
      if (i + 1 >= n) phones.push('AY');
      else phones.push(singerMagicE(w, i+1) ? 'AY' : 'IH');
      i += 1;
    }
    else if (ch === 'o'){
      if (i + 1 >= n) phones.push('OW');
      else if (singerMagicE(w, i+1) || singerOpenSyllable(w, i)) phones.push('OW');
      else phones.push('AA');
      i += 1;
    }
    else if (ch === 'u'){
      if (i + 1 >= n) phones.push('UW');
      else if (singerMagicE(w, i+1) || singerOpenSyllable(w, i)) phones.push('UW');
      else phones.push('AH');
      i += 1;
    }
    else if (ch === 'y'){
      if (i === 0) phones.push('Y');
      else if (i + 1 >= n) phones.push(n <= 3 ? 'AY' : 'IY');
      else phones.push('IH');
      i += 1;
    }
    else if (ch === 'c'){ phones.push('eiy'.includes(nxt) ? 'S' : 'K'); i += 1; }
    else if (ch === 'g'){ phones.push('eiy'.includes(nxt) ? 'JH' : 'G'); i += 1; }
    else if (ch === 's'){
      const voiced = SINGER_VOWEL_LETTERS.has(prev) && SINGER_VOWEL_LETTERS.has(nxt);
      phones.push(voiced ? 'Z' : 'S'); i += 1;
    }
    else if (ch === 'x'){ phones.push('K','S'); i += 1; }
    else if (ch === 'j'){ phones.push('JH'); i += 1; }
    else if (ch === 'h'){ phones.push('HH'); i += 1; }
    else if (SINGER_CONSONANT_LETTERS.has(ch)){ phones.push(ch.toUpperCase()); i += 1; }
    else { i += 1; }
  }
  return singerFixInflections(w, phones);
}

// --------------------------------------------------------- the dictionary ---

// CMUdict, unpacked on first use. 123,000 words that a person checked, in the
// same ARPAbet this engine speaks -- the difference between knowing how a word
// is said and inferring it from spelling.
//
// It ships front-coded: the word list is sorted, so each line stores only how
// many characters it shares with the line before. That takes 3.3 MB of JSON
// down to 1.4, and costs a few milliseconds to undo, once.
let CMUDICT = null;

function cmudict() {
  if (CMUDICT) return CMUDICT;
  CMUDICT = new Map();
  if (typeof CMUDICT_PACKED === 'undefined') return CMUDICT;
  const syms = CMUDICT_SYMBOLS;
  let prev = '';
  for (const line of CMUDICT_PACKED.split('\n')) {
    if (line.length < 3) continue;
    const shared = line.charCodeAt(0) - 33;
    const sp = line.indexOf(' ');
    if (sp < 1) continue;
    const word = prev.slice(0, shared) + line.slice(1, sp);
    const ph = [];
    for (let i = sp + 1; i < line.length; i++) {
      ph.push(syms[line.charCodeAt(i) - 33]);
    }
    CMUDICT.set(word, ph);
    prev = word;
  }
  return CMUDICT;
}

function cmuLookup(w) {
  const d = cmudict();
  const hit = d.get(w);
  return hit ? hit.slice() : null;
}
window.cmudict = cmudict;
window.cmuLookup = cmuLookup;

function singerWordToPhonemes(word){
  if (!word) return [];
  const override = /^\s*[\[{]([^\]}]+)[\]}]\s*$/.exec(word);
  if (override){
    return override[1].trim().split(/\s+/).map(p => p.toUpperCase())
      .filter(p => singerIsVowel(p) || SINGER_DATA.CONSONANTS[p]);
  }
  let w = word.toLowerCase().trim().replace(/[^a-z']/g, '');
  if (!w) return [];
  // The curated list wins: it holds deliberate corrections CMUdict cannot
  // know about, including the misspellings hymn engravers leave in lyric
  // lines ("strenght", "dweels"), which are not words and so are not in any
  // dictionary.
  if (SINGER_DATA.LEXICON[w]) return SINGER_DATA.LEXICON[w].slice();
  const fromCmu = cmuLookup(w);
  if (fromCmu) return fromCmu;
  if (w.includes("'")){
    const base = w.split("'")[0];
    if (SINGER_DATA.LEXICON[base]) return SINGER_DATA.LEXICON[base].slice();
  }
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 2){
    const stems = w.endsWith('es') ? [w.slice(0,-2), w.slice(0,-1)] : [w.slice(0,-1)];
    for (const stem of stems){
      if (SINGER_DATA.LEXICON[stem]) return singerAddPlural(SINGER_DATA.LEXICON[stem].slice());
    }
  }
  // Engravers double letters at syllable joins ("ins-stru-ments"), which hides
  // an otherwise known word. Collapse doubled consonants and retry the lexicon
  // only -- the rules still run on the original spelling.
  const collapsed = w.replace(/([bcdfghjklmnpqrstvwxz])\1/g, '$1');
  if (collapsed !== w){
    if (SINGER_DATA.LEXICON[collapsed]) return SINGER_DATA.LEXICON[collapsed].slice();
    if (collapsed.endsWith('s') && !collapsed.endsWith('ss') && collapsed.length > 2){
      const stems = collapsed.endsWith('es')
        ? [collapsed.slice(0,-2), collapsed.slice(0,-1)] : [collapsed.slice(0,-1)];
      for (const stem of stems){
        if (SINGER_DATA.LEXICON[stem]) return singerAddPlural(SINGER_DATA.LEXICON[stem].slice());
      }
    }
  }
  return singerRules(w.replace(/'/g, ''));
}

function singerSplitSyllables(phones, count){
  if (count <= 1 || !phones.length) return phones.length ? [phones] : [[]];
  const nuclei = [];
  phones.forEach((p, i) => { if (singerIsVowel(p)) nuclei.push(i); });
  if (!nuclei.length){
    const out = [phones];
    while (out.length < count) out.push([]);
    return out;
  }
  if (nuclei.length < count){
    const groups = singerSplitSyllables(phones, nuclei.length);
    while (groups.length < count){
      const tail = groups[groups.length-1];
      let vowel = 'AH';
      for (let i = tail.length-1; i >= 0; i--){ if (singerIsVowel(tail[i])){ vowel = tail[i]; break; } }
      groups.push([vowel]);
    }
    return groups;
  }
  const step = nuclei.length / count;
  let chosen = [];
  for (let k = 0; k < count; k++){
    chosen.push(nuclei[Math.min(Math.round(k*step), nuclei.length-1)]);
  }
  chosen = Array.from(new Set(chosen)).sort((a,b)=>a-b);
  for (const cand of nuclei){
    if (chosen.length >= count) break;
    if (!chosen.includes(cand)){ chosen.push(cand); chosen.sort((a,b)=>a-b); }
  }
  chosen = chosen.slice(0, count);

  const cuts = [0];
  for (let k = 0; k + 1 < chosen.length; k++){
    const a = chosen[k], b = chosen[k+1];
    const between = phones.slice(a+1, b);
    let cut;
    if (!between.length) cut = b;
    else if (between.length === 1) cut = b - 1;
    else {
      cut = b - 1;
      for (let take = Math.min(3, between.length); take >= 1; take--){
        if (SINGER_LEGAL_ONSETS.has(between.slice(-take).join(','))){ cut = b - take; break; }
      }
    }
    cuts.push(cut);
  }
  cuts.push(phones.length);
  const groups = [];
  for (let k = 0; k < count; k++){
    const g = phones.slice(cuts[k], cuts[k+1]);
    groups.push(g.length ? g : ['AH']);
  }
  return groups;
}

function singerLyricToPhonemes(parts){
  const clean = parts.filter(p => p != null);
  if (!clean.length) return [];
  if (clean.some(s => /^\s*[\[{][^\]}]+[\]}]\s*$/.test(s || ''))){
    return clean.map(s => singerWordToPhonemes(s));
  }
  const joined = clean.map(s => (s || '').replace(/[^A-Za-z']/g, '')).join('');
  const phones = singerWordToPhonemes(joined);
  if (!phones.length) return clean.map(() => []);
  return singerSplitSyllables(phones, clean.length);
}

// Split a syllable into [onset consonants, nucleus, coda consonants].
function singerSplitPhones(phones){
  if (!phones || !phones.length) return [[], 'AH', []];
  let at = -1;
  for (let i = 0; i < phones.length; i++){ if (singerIsVowel(phones[i])){ at = i; break; } }
  if (at < 0){
    if (phones.length === 1) return [[], phones[0], []];
    return [phones.slice(0, -1), phones[phones.length-1], []];
  }
  return [phones.slice(0, at), phones[at], phones.slice(at+1)];
}

function singerConsonantDur(p){
  const c = SINGER_DATA.CONSONANTS[p];
  if (!c) return 0;
  if (c.cls === 'stop') return c.closure + c.burst + (c.aspir || 0);
  if (c.cls === 'affricate') return c.closure + c.burst + c.fric;
  return c.dur || 0.06;
}

// Tone.js v14 builds its whole graph out of standardized-audio-context
// wrapper nodes, not the browser's own AudioNodes -- `dest.input instanceof
// AudioNode` is false. A genuinely native node cannot be connected into that
// graph at all: the connect throws, or worse, silently joins nothing. So every
// node here is created from Tone.getContext(), which hands back wrappers from
// the same graph the mixer is built in. Never reach for rawContext.create*()
// or dig out an inner native node to build from -- both look right and are
// silent in exactly the case that matters.

// --------------------------------------------------- the voice -------------

class FormantSingerVoice {
  constructor(voiceType, style){
    const ctx = Tone.getContext();
    this.ctx = ctx;
    // Tone.Sampler reads a 4th argument as velocity, so the scheduler
    // only passes phonemes to voices that ask for them by name.
    this.wantsPhonemes = true;
    this.cfg = this._config(voiceType || 'tenor', style || 'choral');

    this.out = ctx.createGain();
    this.out.gain.value = 0.9;

    // --- parallel formant bank, shared by every note on this staff
    this.bank = [];
    this.bankGains = [];
    const sum = ctx.createGain();
    sum.gain.value = 1.0;
    for (let k = 0; k < 5; k++){
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      const base = this.cfg.scaledSchwa[k];
      f.frequency.value = base;
      f.Q.value = base / SINGER_DATA.VOWEL_BW[k];
      const g = ctx.createGain();
      g.gain.value = SINGER_FORMANT_GAINS[k];
      f.connect(g); g.connect(sum);
      this.bank.push(f); this.bankGains.push(g);
    }
    // fixed high poles: not part of the phoneme-tracked bank, so they keep a
    // constant frequency and simply restore the missing top octave
    SINGER_HIGH_POLES.forEach(p => {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = p.hz * this.cfg.scale;
      f.Q.value = p.hz / p.bw;
      const g = ctx.createGain();
      g.gain.value = p.gain;
      f.connect(g); g.connect(sum);
      this.highPoles = this.highPoles || [];
      this.highPoles.push(f, g);
      this.bankExtra = this.bankExtra || [];
      this.bankExtra.push(f);
    });

    this.bankIn = ctx.createGain();
    this.bank.forEach(f => this.bankIn.connect(f));
    (this.bankExtra || []).forEach(f => this.bankIn.connect(f));

    // A little unfiltered signal keeps notes from thinning out when the
    // harmonics fall between the formant bands.
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.10;
    this.bankIn.connect(this.dry);

    // Singer formant: the ~3 kHz ring that lets a voice carry.
    this.ring = ctx.createBiquadFilter();
    this.ring.type = 'bandpass';
    this.ring.frequency.value = this.cfg.singer_hz;
    this.ring.Q.value = 3.5;
    this.ringGain = ctx.createGain();
    this.ringGain.gain.value = Math.min(0.5, this.cfg.singer_db / 24);
    this.bankIn.connect(this.ring); this.ring.connect(this.ringGain);

    sum.connect(this.out);
    this.dry.connect(this.out);
    this.ringGain.connect(this.out);

    this.wave = this._glottalWave();
    this.noiseBuf = this._noiseBuffer();

    // Shared vibrato LFO; each note taps it through its own depth gain so
    // notes can fade their vibrato in independently.
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = this.cfg.vib_hz;
    this.lfo.start();

    this.lastFreq = null;
    this.lastEnd = 0;
    this.live = [];
    this.disposed = false;
  }

  _config(voiceType, style){
    const v = SINGER_DATA.VOICES[voiceType] || SINGER_DATA.VOICES.tenor;
    const s = SINGER_DATA.STYLES[style] || SINGER_DATA.STYLES.classical;
    const scale = v.scale;
    const taper = [1.0, 1.0, 0.94, 0.88, 0.84];
    const scaleF = (arr) => arr.map((f, i) => f * (1 + (scale - 1) * taper[i]));
    return {
      scale, scaleF,
      scaledSchwa: scaleF(SINGER_DATA.SCHWA),
      singer_hz: v.singer_hz,
      singer_db: v.singer_db * s.singer_db_mul,
      breath: v.breath * s.breath_mul,
      oq: Math.min(0.85, v.oq + s.oq_add),
      vib_hz: v.vib_hz,
      vib_cents: v.vib_cents * s.vib_mul,
      vib_delay: s.vib_delay,
      porta: s.porta
    };
  }

  // Rosenberg glottal-flow derivative as a band-limited PeriodicWave. The
  // discontinuity at glottal closure is what makes a voice sound like a voice
  // rather than an organ, and a PeriodicWave gives us that without aliasing.
  _glottalWave(){
    const N = 1024, H = 64;
    const oq = this.cfg.oq;
    const t1 = oq * 0.70, t2 = oq * 0.30;
    const x = new Float64Array(N);
    for (let i = 0; i < N; i++){
      const f = i / N;
      if (f < t1) x[i] = 0.5 * Math.sin(Math.PI * f / t1) * (Math.PI / t1);
      else if (f < t1 + t2) x[i] = -Math.sin(Math.PI * (f - t1) / (2 * t2)) * (Math.PI / (2 * t2));
      else x[i] = 0;
    }
    const real = new Float32Array(H), imag = new Float32Array(H);
    for (let k = 1; k < H; k++){
      let re = 0, im = 0;
      for (let i = 0; i < N; i++){
        const ang = 2 * Math.PI * k * i / N;
        re += x[i] * Math.cos(ang);
        im += x[i] * Math.sin(ang);
      }
      real[k] = (2 / N) * re;
      imag[k] = (2 / N) * im;
    }
    return this.ctx.createPeriodicWave(real, imag);
  }

  _noiseBuffer(){
    const n = Math.floor(this.ctx.sampleRate * 2);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  connect(dest){
    // Connect to the Tone node itself, not to any native node found inside it.
    const target = (dest && dest.input) ? dest.input : dest;
    try { this.out.connect(target); }
    catch(err){
      // Never swallow this. A failed connect leaves a voice that looks alive
      // -- notes schedule, no error appears -- and plays nothing at all.
      console.error('FormantSingerVoice: could not connect to the mixer', err);
    }
    return this;
  }

  // Aim the formant bank at a phoneme target at a given time.
  _setFormants(target, bw, time, glide){
    const f = this.cfg.scaleF(target);
    for (let k = 0; k < 5; k++){
      const p = this.bank[k];
      try{
        p.frequency.cancelScheduledValues(time);
        if (glide > 0) p.frequency.linearRampToValueAtTime(f[k], time + glide);
        else p.frequency.setValueAtTime(f[k], time);
        p.Q.setValueAtTime(Math.max(1.2, f[k] / bw[k]), time);
      }catch(err){ /* ignore */ }
    }
  }

  _noiseBurst(cons, start, dur, gainScale){
    if (!cons.noise || dur <= 0.001) return;
    const [center, width, gain] = cons.noise;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = center;
    bp.Q.value = Math.max(0.4, center / Math.max(120, width));
    const g = this.ctx.createGain();
    const peak = gain * (gainScale == null ? 1 : gainScale);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + Math.min(0.008, dur * 0.4));
    g.gain.linearRampToValueAtTime(0.0001, start + dur);
    src.connect(bp); bp.connect(g); g.connect(this.out);
    src.start(start);
    src.stop(start + dur + 0.02);
    this._track(src, [bp, g]);
  }

  _track(src, nodes){
    const entry = { src, nodes };
    this.live.push(entry);
    src.onended = () => {
      try{ src.disconnect(); }catch(e){}
      nodes.forEach(nd => { try{ nd.disconnect(); }catch(e){} });
      const i = this.live.indexOf(entry);
      if (i >= 0) this.live.splice(i, 1);
    };
  }

  // freq: Hz, dur: seconds, time: AudioContext time, phones: ARPAbet array
  triggerAttackRelease(freq, dur, time, phones){
    if (this.disposed) return this;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    time = Math.max(time, now + 0.002);
    dur = Math.max(0.05, dur);

    const list = (phones && phones.length) ? phones : ['AH'];
    const [onsets, nucleus, codas] = singerSplitPhones(list);

    // Consonants are sung ahead of the beat so the vowel lands on it, clamped
    // to whatever lookahead we actually have.
    let onsetTotal = 0;
    onsets.forEach(p => { onsetTotal += singerConsonantDur(p); });
    const room = Math.max(0, time - Math.max(now + 0.002, this.lastEnd));
    const scale = onsetTotal > room && onsetTotal > 0 ? Math.max(0.35, room / onsetTotal) : 1;
    const onsetDur = onsetTotal * scale;
    const vowelStart = time;
    let t = Math.max(now + 0.002, vowelStart - onsetDur);

    // --- onset consonants: formant locus + any frication
    onsets.forEach(p => {
      const c = SINGER_DATA.CONSONANTS[p];
      if (!c) return;
      const d = singerConsonantDur(p) * scale;
      if (c.fmt) this._setFormants(c.fmt, c.bw, t, Math.min(0.03, d * 0.6));
      if (c.cls === 'stop' || c.cls === 'affricate'){
        this._noiseBurst(c, t + c.closure * scale, (c.burst + (c.aspir || c.fric || 0)) * scale, 1);
      } else if (c.noise){
        this._noiseBurst(c, t, d, 1);
      }
      t += d;
    });

    // --- the vowel
    const vt = SINGER_DATA.VOWELS[nucleus];
    const bw = SINGER_DATA.VOWEL_BW;
    if (vt){
      this._setFormants(vt[0], bw, vowelStart, onsets.length ? 0.035 : 0.02);
      if (vt.length > 1){
        // diphthong: hold the nucleus, glide to the offglide late
        // (linearRamp starts at the previous event, so pin the nucleus first or
        // the glide would begin at the note onset and smear the vowel)
        const holdT = vowelStart + dur * 0.5;
        this._setFormants(vt[0], bw, holdT - 0.001, 0);
        this._setFormants(vt[1], bw, holdT, Math.max(0.05, dur * 0.35));
      }
    } else {
      const c = SINGER_DATA.CONSONANTS[nucleus];
      if (c && c.fmt) this._setFormants(c.fmt, c.bw, vowelStart, 0.03);
    }

    // --- coda consonants at the tail of the note
    let codaTotal = 0;
    codas.forEach(p => { codaTotal += singerConsonantDur(p); });
    const vowelEnd = Math.max(vowelStart + 0.04, vowelStart + dur - codaTotal);
    let ct = vowelEnd;
    codas.forEach(p => {
      const c = SINGER_DATA.CONSONANTS[p];
      if (!c) return;
      const d = singerConsonantDur(p);
      if (c.fmt) this._setFormants(c.fmt, c.bw, ct, Math.min(0.03, d * 0.6));
      if (c.cls === 'stop' || c.cls === 'affricate'){
        this._noiseBurst(c, ct + c.closure, (c.burst + (c.aspir || c.fric || 0)), 0.9);
      } else if (c.noise){
        this._noiseBurst(c, ct, d, 0.9);
      }
      ct += d;
    });

    // --- the glottal source for this note
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.wave);

    const legato = this.lastFreq && (vowelStart - this.lastEnd) < 0.06;
    const start = Math.max(now + 0.001, t - 0.004);
    if (legato){
      const porta = Math.min(this.cfg.porta, dur * 0.45);
      osc.frequency.setValueAtTime(this.lastFreq, start);
      osc.frequency.linearRampToValueAtTime(freq, start + porta);
    } else {
      // a small scoop up into the note, the way a voice approaches a pitch
      osc.frequency.setValueAtTime(freq * Math.pow(2, -30/1200), start);
      osc.frequency.linearRampToValueAtTime(freq, start + 0.045);
    }

    // vibrato, faded in only on notes long enough to earn it
    const depth = ctx.createGain();
    depth.gain.value = 0;
    this.lfo.connect(depth);
    depth.connect(osc.detune);
    if (dur > this.cfg.vib_delay + 0.12){
      const vs = vowelStart + this.cfg.vib_delay;
      depth.gain.setValueAtTime(0, vs);
      depth.gain.linearRampToValueAtTime(this.cfg.vib_cents, vs + 0.22);
      depth.gain.setValueAtTime(this.cfg.vib_cents, Math.max(vs + 0.22, vowelStart + dur - 0.06));
      depth.gain.linearRampToValueAtTime(this.cfg.vib_cents * 0.35, vowelStart + dur);
    }

    // amplitude: reaches back over the onset consonants so a phrase-initial
    // voiced consonant is not silent
    const amp = ctx.createGain();
    const cons0 = onsets.length ? SINGER_DATA.CONSONANTS[onsets[0]] : null;
    const voicedOnset = !!(cons0 && cons0.voiced);
    const peak = 0.28;
    amp.gain.setValueAtTime(0, start);
    if (onsets.length && voicedOnset){
      amp.gain.linearRampToValueAtTime(peak * 0.35, start + Math.min(0.02, onsetDur));
      amp.gain.linearRampToValueAtTime(peak, vowelStart + 0.02);
    } else {
      amp.gain.linearRampToValueAtTime(peak, vowelStart + (legato ? 0.015 : 0.045));
    }
    const end = vowelStart + dur;
    const c0 = codas.length ? SINGER_DATA.CONSONANTS[codas[0]] : null;
    if (c0 && !c0.voiced && (c0.cls === 'stop' || c0.cls === 'affricate' || c0.cls === 'fricative')){
      // voiceless coda (the t of "let"): the folds stop, only noise remains
      amp.gain.setValueAtTime(peak, Math.max(vowelStart + 0.05, vowelEnd - 0.005));
      amp.gain.linearRampToValueAtTime(0.0001, Math.max(vowelStart + 0.06, vowelEnd + 0.02));
    } else {
      amp.gain.setValueAtTime(peak, Math.max(vowelStart + 0.05, end - 0.05));
      amp.gain.linearRampToValueAtTime(0.0001, end + 0.06);
    }

    // breath mixed in at the glottis
    const br = ctx.createBufferSource();
    br.buffer = this.noiseBuf;
    br.loop = true;
    const brg = ctx.createGain();
    brg.gain.setValueAtTime(0, start);
    brg.gain.linearRampToValueAtTime(this.cfg.breath * 0.9, vowelStart + 0.05);
    brg.gain.linearRampToValueAtTime(0.0001, end + 0.06);
    br.connect(brg); brg.connect(this.bankIn);
    br.start(start); br.stop(end + 0.1);
    this._track(br, [brg]);

    osc.connect(amp); amp.connect(this.bankIn);
    osc.start(start);
    osc.stop(end + 0.12);
    this._track(osc, [amp, depth]);

    this.lastFreq = freq;
    this.lastEnd = end;
    return this;
  }

  dispose(){
    this.disposed = true;
    try{ this.lfo.stop(); }catch(e){}
    this.live.slice().forEach(entry => {
      try{ entry.src.stop(); }catch(e){}
      try{ entry.src.disconnect(); }catch(e){}
      entry.nodes.forEach(nd => { try{ nd.disconnect(); }catch(e){} });
    });
    this.live = [];
    [this.out, this.bankIn, this.dry, this.ring, this.ringGain, this.lfo]
      .concat(this.bank).concat(this.bankGains).concat(this.highPoles || [])
      .forEach(nd => { try{ nd.disconnect(); }catch(e){} });
  }
}

