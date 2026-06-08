#!/usr/bin/env python3
"""Generate a REO (lean: Domain > Aspect + Sentiment) gold-set CSV for human review.
Source: real Ruth's Chris reviews pulled read-only from dataset_rows_flat.
One row per observation (multi-label). review_text repeated per row so each line
is self-contained in a spreadsheet. NOT production code — a one-off review artifact."""
import csv, os

# Each review: id, rating, text, observations[(domain, aspect, sentiment, evidence, severity, note)]
# sentiment at observation grain = Positive | Negative | Neutral (review-level "Mixed" emerges
# from a review carrying both). severity flag only for allergy / food-safety / discrimination.
R = [
 ("R01",1,"Tried to walk in and they \"wouldn't be able to seat us.\" Restaurant wasn't busy and plenty of open reservations on Open Table. Made a reservation and still got refused and told to sit in the bar. Service has been consistently declining at this location and I won't be back.",
  [("Operations","Reservations","Negative","still got refused","",""),
   ("Brand","Consistency","Negative","consistently declining","",""),
   ("CustomerRelationship","Loyalty","Negative","I won't be back","","old 'outcome:not-recommend' maps here")]),

 ("R02",1,"Didn't feel welcomed and the manager named Tammy nitpicked with me about a hat. We were the last guests there. Other guests had on skull hats and plain t-shirts and they were in dress code. I would have tipped but they took my change and didn't give change. Horrible experience won't come back. They ruined our night then tried to make up for it with a free drink, the damage was done.",
  [("Service","Professionalism","Negative","nitpicked with me about a hat","","dress-code enforcement felt unfair"),
   ("Service","Management","Negative","the manager named Tammy","",""),
   ("Operations","Payment","Negative","took my change and didn't give change","",""),
   ("Service","Recovery","Negative","make up for it with a free drink","","recovery attempted but failed"),
   ("CustomerRelationship","Loyalty","Negative","won't come back","","")]),

 ("R03",1,"Steak was cut wrong, tough as leather. Overcooked, not medium rare. Manager was snotty when I pointed it out. I shant return.",
  [("FoodBeverage","Preparation","Negative","Overcooked, not medium rare","","doneness miss = Preparation"),
   ("FoodBeverage","Quality","Negative","tough as leather","",""),
   ("Service","Recovery","Negative","Manager was snotty when I pointed it out","","complaint handling"),
   ("CustomerRelationship","Loyalty","Negative","I shant return","","")]),

 ("R04",1,"Today I had the turkey dinner for Thanksgiving menu. It was equivalent to dog food. The turkey breast was white processed meat. The stuffing was dried out and horrible. The dessert was a joke, a round piece of pumpkin cheesecake the size of a silver dollar. I will never recommend this restaurant to anyone.",
  [("FoodBeverage","Quality","Negative","equivalent to dog food","",""),
   ("FoodBeverage","Preparation","Negative","stuffing was dried out","",""),
   ("FoodBeverage","Desserts","Negative","dessert was a joke","",""),
   ("FoodBeverage","Portion","Negative","size of a silver dollar","",""),
   ("Brand","Reputation","Negative","never recommend this restaurant","","")]),

 ("R05",1,"Was there for my fiancee's birthday. She ordered a filet medium well done and the wait staff and manager all argued with her that the filet could not be cooked that way, so the dinner was ruined for her. My salmon was good, then our friend's chicken was bland. Not a great experience for her 1st time and we will probably not visit again.",
  [("Occasion","Birthday","Neutral","my fiancee's birthday","","visit context"),
   ("Service","Recovery","Negative","argued with her","","argued instead of accommodating"),
   ("FoodBeverage","Taste","Positive","My salmon was good","",""),
   ("FoodBeverage","Taste","Negative","friend's chicken was bland","",""),
   ("CustomerRelationship","Loyalty","Negative","probably not visit again","","")]),

 ("R06",1,"Completely short staffed, unorganized, steak was overcooked, was never given waters at any point, ordering drinks and waiting for them felt like pulling teeth. We've been to numerous Ruth Chris locations and this is by far the worst.",
  [("Operations","Capacity","Negative","Completely short staffed","","staffing levels"),
   ("FoodBeverage","Preparation","Negative","steak was overcooked","",""),
   ("Service","Attentiveness","Negative","never given waters at any point","",""),
   ("Service","Responsiveness","Negative","waiting for them felt like pulling teeth","",""),
   ("Brand","Consistency","Negative","by far the worst","","vs other locations")]),

 ("R07",1,"The waiter was rude and acted as if me and my guest didn't belong there. After sending my food back twice, I really had no desire to eat it. A complete waste.",
  [("Service","Friendliness","Negative","The waiter was rude","",""),
   ("Service","Professionalism","Negative","acted as if me and my guest didn't belong","",""),
   ("Service","Accuracy","Negative","sending my food back twice","","order issues")]),

 ("R08",1,"People will play in your face all day when you order take out. $50 for salt and pepper chicken breast and it wasn't even stuffed.",
  [("Operations","Ordering","Negative","when you order take out","","takeout handling"),
   ("FoodBeverage","Quality","Negative","wasn't even stuffed","",""),
   ("Value","ValueForMoney","Negative","$50 for salt and pepper chicken breast","","")]),

 ("R09",1,"Plates are hot, and the server says don't touch. But they don't warn you of the splash zone of the butter spitting from the plate. Brand new purse on the seat next to me was ruined.",
  [("Service","Professionalism","Negative","they don't warn you","","failure to warn = service lapse"),
   ("FoodBeverage","Presentation","Neutral","the butter spitting from the plate","","sizzling-plate presentation, edge case")]),

 ("R10",1,"The manager turned me and my friend away from the bar area because cleavage was shown. But there was a white lady with her cleavage out as well. I felt we were discriminated against and the manager was racist.",
  [("Service","Professionalism","Negative","turned me and my friend away","FLAG","discrimination claim - escalate/review"),
   ("Brand","Trust","Negative","I felt we were discriminated against","FLAG","brand-trust + DEI risk")]),

 ("R11",2,"Seated 30 minutes after reservation, entree showed up 40 minutes after salad, $68 ribeye only warm (definitely NOT sizzling). Wife's shrimp was so overcooked they were not edible. Salad and bread were good.",
  [("Operations","Reservations","Negative","Seated 30 minutes after reservation","",""),
   ("Operations","WaitTime","Negative","entree showed up 40 minutes after salad","",""),
   ("FoodBeverage","Preparation","Negative","ribeye only warm","","temp"),
   ("FoodBeverage","Preparation","Negative","shrimp was so overcooked","",""),
   ("FoodBeverage","Quality","Positive","Salad and bread were good","",""),
   ("Value","Pricing","Negative","$68 ribeye","","price cited as grievance")]),

 ("R12",2,"The food was great! But the service was terrible, hardly ever saw our waiter, and when he did come by it took forever. We bought the 3 course dinner and weren't even offered dessert.",
  [("FoodBeverage","Taste","Positive","The food was great","",""),
   ("Service","Attentiveness","Negative","hardly ever saw our waiter","",""),
   ("Service","Responsiveness","Negative","it took forever","",""),
   ("FoodBeverage","Desserts","Negative","weren't even offered dessert","","")]),

 ("R13",2,"Honestly the place needs to be remodeled. When you enter it smells old and moldy and mothbally. I sat at the bar, ordered my food, and people who sat and ordered after me received their order before me.",
  [("Environment","Cleanliness","Negative","smells old and moldy","","odor = cleanliness"),
   ("Environment","Design","Negative","needs to be remodeled","",""),
   ("Service","Attentiveness","Negative","received their order before me","","served out of order")]),

 ("R14",2,"Absolute worst old fashioned and manhattan I have ever had, creamed spinach was watery and gross, service was borderline, steak was good but whole experience was super mid.",
  [("FoodBeverage","Beverages","Negative","worst old fashioned and manhattan","",""),
   ("FoodBeverage","Quality","Negative","creamed spinach was watery","",""),
   ("Service","Friendliness","Negative","service was borderline","",""),
   ("FoodBeverage","Preparation","Positive","steak was good","",""),
   ("Value","ValueForMoney","Negative","whole experience was super mid","","")]),

 ("R15",2,"The steak was good, a little underseasoned but cooked nicely. The cocktail was alright, a bit watered down for $25. Potatoes were gritty and dry. The decor made it feel like a cheesy sports bar. Dirty washrooms. Great wait staff though! Probably won't go back as it just was not worth the price.",
  [("FoodBeverage","Preparation","Positive","cooked nicely","",""),
   ("FoodBeverage","Taste","Negative","a little underseasoned","",""),
   ("FoodBeverage","Beverages","Negative","watered down for $25","",""),
   ("FoodBeverage","Quality","Negative","Potatoes were gritty and dry","",""),
   ("Environment","Design","Negative","cheesy sports bar","",""),
   ("Environment","Cleanliness","Negative","Dirty washrooms","",""),
   ("Service","Friendliness","Positive","Great wait staff","",""),
   ("Value","ValueForMoney","Negative","not worth the price","",""),
   ("CustomerRelationship","Loyalty","Negative","won't go back","","")]),

 ("R16",2,"At least 4 of a party of 15 had cold hard mashed potatoes that had to be sent back. Another side was offered. The restaurant was not even crowded and no reason for slow cold food. I have been coming here for over 25 years and this was horrible.",
  [("FoodBeverage","Preparation","Negative","cold hard mashed potatoes","","temp"),
   ("Service","Recovery","Positive","Another side was offered","","recovery handled"),
   ("Operations","WaitTime","Negative","slow cold food","",""),
   ("Brand","Consistency","Negative","over 25 years and this was horrible","","loyal customer, off night")]),

 ("R17",3,"Party of 7 took 2 hours. She told the waiter she is allergic to mushrooms; steak and shrimp came out with truffle on it. Steak was remade with no truffles, but no shrimp. After notifying staff, shrimp came out quick but very undercooked and raw in the middle. Drinks from the bar were average at best.",
  [("Operations","WaitTime","Negative","took 2 hours","",""),
   ("Service","Accuracy","Negative","came out with truffle on it","FLAG","stated allergy not honored - safety"),
   ("FoodBeverage","Preparation","Negative","undercooked and raw in the middle","",""),
   ("FoodBeverage","Beverages","Negative","average at best","",""),
   ("Service","Recovery","Neutral","Steak was remade","","partial recovery")]),

 ("R18",3,"Espresso Martini was nasty (and taken off the bill). Crab cakes were good but not amazing. Shrimp with filet were super rubbery. Service felt slow in that every time he was by we needed something.",
  [("FoodBeverage","Beverages","Negative","Espresso Martini was nasty","",""),
   ("Service","Recovery","Positive","taken off the bill","","comped"),
   ("FoodBeverage","Taste","Positive","Crab cakes were good","",""),
   ("FoodBeverage","Preparation","Negative","super rubbery","",""),
   ("Service","Attentiveness","Negative","Service felt slow","","")]),

 ("R19",3,"Steak is consistently overcooked. Service is bland and seems untrained. Not a great value proposition overall. Atmosphere is generic. Go somewhere else if in Nashville.",
  [("FoodBeverage","Preparation","Negative","consistently overcooked","",""),
   ("Service","Professionalism","Negative","seems untrained","",""),
   ("Value","ValueForMoney","Negative","Not a great value proposition","",""),
   ("Environment","Ambiance","Negative","Atmosphere is generic","",""),
   ("Brand","Consistency","Negative","consistently overcooked","","")]),

 ("R20",3,"Spicy shrimp was not crispy. Caesar salad was not fresh. Bread pudding had too much alcohol. Steak sandwich was delicious. 6.5/10 Happy Hour. Great atmosphere.",
  [("FoodBeverage","Preparation","Negative","shrimp was not crispy","",""),
   ("FoodBeverage","Quality","Negative","Caesar salad was not fresh","",""),
   ("FoodBeverage","Desserts","Negative","Bread pudding had too much alcohol","",""),
   ("FoodBeverage","Taste","Positive","Steak sandwich was delicious","",""),
   ("Environment","Ambiance","Positive","Great atmosphere","",""),
   ("Value","ValueForMoney","Neutral","6.5/10 Happy Hour","","")]),

 ("R21",3,"Great service and experience, just not top notch food. Could tell my lobster was from the freezer and had to get my mashed potatoes reheated right after it came out.",
  [("Service","Friendliness","Positive","Great service and experience","",""),
   ("FoodBeverage","Quality","Negative","lobster was from the freezer","",""),
   ("FoodBeverage","Preparation","Negative","mashed potatoes reheated","","")]),

 ("R22",5,"The cheesecake is very good. It's fresh and with the yogurt and berries on top it's perfect.",
  [("FoodBeverage","Desserts","Positive","cheesecake is very good","","")]),

 ("R23",5,"JUAN-PIERRE is the best server here at Ruth's Chris.",
  [("Service","Friendliness","Positive","best server","","named-staff praise")]),

 ("R24",5,"Service was slowish. Apps and salads were delivered together. Not that big of a deal, overall very enjoyable.",
  [("Service","Responsiveness","Negative","Service was slowish","","mild"),
   ("Operations","Ordering","Negative","Apps and salads were delivered together","","coursing/sequence"),
   ("FoodBeverage","Taste","Positive","overall very enjoyable","","")]),

 ("R25",5,"The food was good except the mashed potatoes and asparagus were horrible. Everything else was great. The service and atmosphere was outstanding.",
  [("FoodBeverage","Taste","Positive","The food was good","",""),
   ("FoodBeverage","Quality","Negative","mashed potatoes and asparagus were horrible","","sides"),
   ("Service","Friendliness","Positive","service ... was outstanding","",""),
   ("Environment","Ambiance","Positive","atmosphere was outstanding","","")]),

 ("R26",5,"We found the level of service unparalleled. The server was very knowledgeable. The wine selection was excellent quality. The GM visited our table and was very warm and professional.",
  [("Service","Professionalism","Positive","service unparalleled","",""),
   ("Service","Knowledge","Positive","server was very knowledgeable","",""),
   ("FoodBeverage","Beverages","Positive","wine selection was excellent","",""),
   ("Service","Management","Positive","GM visited our table","","")]),

 ("R27",5,"The waitress was absolutely amazing! My steak was cooked exactly how I like it. My only complaint would be the lack of non-alcoholic drink choices!",
  [("Service","Friendliness","Positive","waitress was absolutely amazing","",""),
   ("FoodBeverage","Preparation","Positive","cooked exactly how I like it","",""),
   ("FoodBeverage","Menu","Negative","lack of non-alcoholic drink choices","","menu variety / NAB options")]),

 ("R28",5,"Steak came out sizzling, seasoned to perfection. Mashed potatoes, perfect. Asparagus perfect. I chose a Cabernet to pair with my NY strip. The Lacantera location is very nicely decorated, we will visit again.",
  [("FoodBeverage","Preparation","Positive","seasoned to perfection","",""),
   ("FoodBeverage","Quality","Positive","Mashed potatoes, perfect","",""),
   ("FoodBeverage","Beverages","Positive","a Cabernet to pair","",""),
   ("Environment","Design","Positive","very nicely decorated","",""),
   ("CustomerRelationship","Loyalty","Positive","we will visit again","","")]),

 ("R29",5,"We spent our 12th wedding anniversary here and it did not disappoint! Steaks were perfectly cooked, our lobster mac and cheese was fantastic, and the carrot cake was incredible! Great service. Even seated us 20 minutes before our reservation.",
  [("Occasion","Anniversary","Neutral","12th wedding anniversary","","visit context"),
   ("FoodBeverage","Preparation","Positive","Steaks were perfectly cooked","",""),
   ("FoodBeverage","Quality","Positive","lobster mac and cheese was fantastic","",""),
   ("FoodBeverage","Desserts","Positive","carrot cake was incredible","",""),
   ("Service","Friendliness","Positive","Great service","",""),
   ("Operations","Reservations","Positive","seated us 20 minutes before our reservation","","")]),

 ("R30",5,"My blueberry lemon drop was executed to perfection. He had the best recommendations, it was my boyfriend's first experience at Ruth Chris and he made his visit extremely enjoyable.",
  [("FoodBeverage","Beverages","Positive","executed to perfection","",""),
   ("Service","Knowledge","Positive","best recommendations","",""),
   ("CustomerRelationship","Personalization","Positive","made his visit extremely enjoyable","","")]),
]

out = os.path.expanduser("~/Downloads/REO_goldset_draft_v1.csv")
with open(out, "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["review_id","rating","review_text","domain","aspect","sentiment","evidence","severity_flag","labeling_note"])
    obs_count = 0
    for rid, rating, text, obs in R:
        for (dom, asp, sent, ev, sev, note) in obs:
            w.writerow([rid, rating, text, dom, asp, sent, ev, sev, note])
            obs_count += 1
print(f"reviews={len(R)} observations={obs_count} -> {out}")
