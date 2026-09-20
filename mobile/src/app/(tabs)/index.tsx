import { unfiled } from "@/lib/taxonomy";
import { useEffect, useMemo, useRef, useState } from "react";
import { PAINT, SEMANTIC } from "@/lib/brand";
import ShareArea from "@/components/ShareArea";
import { nearbyPlaces } from "@/lib/here";
import { groupPlaces } from "@/lib/place-groups";
import FirstSteps from "@/components/FirstSteps";
import OttoSays from "@/components/OttoSays";
import { PANEL, PANEL_SIDE, useWide } from "@/lib/wide";
import { useCategories } from "@/lib/categories";
import { useRouter } from "expo-router";
import { useAuth } from "@/lib/auth";
import {
  BeenIcon,
  LivedIcon,
  MagnifyingGlassIcon,
  NavigationArrowIcon,
  WantToGoIcon,
} from "@/components/nav-icons";
import { WORLD_SPAN, inView, viewName, viewSubtitle, type Bounds } from "@/lib/map-view";
import { usePlaceSearch } from "@/lib/use-place-search";
import { searchPlaces } from "@/lib/search-places";
import { usePalette } from "@/lib/use-palette";
import { type } from "@/lib/type";
import Glass from "@/components/Glass";
import {
  FAB_SIZE,
  SHEET_PEEK,
  SHEET_SHUT,
  fabBottom,
  sheetPeekHeight,
  tabBarSpace,
} from "@/lib/layout";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PlaceThumb from "@/components/PlaceThumb";
import Stars from "@/components/Stars";
import StatusIcon from "@/components/StatusIcon";
import { useMyLocation } from "@/lib/use-my-location";
import PlaceDetail from "@/components/PlaceDetail";
import SharedPlaceCard from "@/components/SharedPlaceCard";
import PlaceEditor, { placeToDraft, type PlaceDraft } from "@/components/PlaceEditor";
import { api, type Place, type SearchResult, type SharedPlace } from "@/lib/api";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Callout, Marker, type Region } from "react-native-maps";
import { year } from "@/lib/dates";
import { useApi } from "@/lib/use-api";

/// The search field's height, so the chip row beneath it knows where it ends.
/// Both float over the map, so neither can push the other down.
const TOP_ROW_HEIGHT = 46;
const AVATAR = 42;
const FIND_ME_SIZE = 44;

/// One card in the sheet's row: wider than tall, as photographs of places
/// tend to be.
const CARD_WIDTH = 150;
const CARD_PHOTO_HEIGHT = 104;

/// The marker's view, which is a fixed size whatever state the pin is in.
///
/// Apple Maps places a custom marker by its own view's geometry, so a view
/// that changes size drags the pin off the place it is marking — and it clips
/// anything drawn outside that view rather than letting it overhang. So the
/// chosen pin grows *within* an unchanging box, and its name is a callout,
/// which MapKit positions itself.
const PIN_BOX = 44;
const PIN = 32;
const PIN_SELECTED = 42;
/// Wide enough for most names and no wider. MapKit centres the callout on the
/// pin and slides it inwards when it would fall off the screen, so an
/// over-wide box makes a pin near the edge look like it belongs to a
/// neighbour.
const PIN_CALLOUT_WIDTH = 150;

/// How much of the map the list of matches may cover. Shorter than it was:
/// the pins are the answer to "which of these", so the list can stop being
/// the whole of it.
const RESULTS_MAX_HEIGHT = 200;

/// How far from the best match another match still counts as the same
/// neighbourhood, in degrees — roughly twenty-five kilometres.
///
/// Searching a chain gives you every branch the geocoder knows, and framing
/// all of them means framing the country. The ones worth seeing together are
/// the ones near the best answer.
const SAME_AREA = 0.25;

/// Enough of a margin that pins are not welded to the edge of the screen.
const PADDING = 1.4;
const MIN_SPAN = 0.02;
/// The widest region MapKit will accept. It throws rather than clamping, and
/// the exception is fatal: places spread from Reykjavík to Queenstown asked
/// for 375° of longitude and took the app down on launch, before the map had
/// drawn anything. Padding a wide enough spread is all it takes.
const MAX_LAT_SPAN = 180;
const MAX_LNG_SPAN = 360;

/// The region containing every pin. Somebody with places in Lisbon and Tokyo
/// legitimately gets the whole world; somebody with one place gets a
/// neighbourhood rather than a point zoomed in to the paving stones.
function regionFor(places: { lat: number; lng: number }[]): Region | undefined {
  if (places.length === 0) return undefined;

  const lats = places.map((p) => p.lat);
  const lngs = places.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.min(Math.max((maxLat - minLat) * PADDING, MIN_SPAN), MAX_LAT_SPAN),
    longitudeDelta: Math.min(Math.max((maxLng - minLng) * PADDING, MIN_SPAN), MAX_LNG_SPAN),
  };
}

/// What a search found, as one place with a draft ready to save.
///
/// The row in the list and the pin on the map are the same offer, so they
/// build the same draft rather than each writing out the fields again.
function draftFromResult(r: SearchResult): PlaceDraft {
  return {
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    category: r.category,
    address: r.address,
    city: r.city,
    country: r.country,
    countryCode: r.countryCode,
  };
}

/// The matches worth framing together: the best one, and anything near it.
///
/// "Lawson" in Tokyo is the case this exists for — the geocoder answers with
/// branches across the country, and a view wide enough for all of them is a
/// view of Japan with no way to tell which one you are standing outside.
function sameArea(results: SearchResult[]) {
  const best = results[0];
  if (!best) return [];
  return results.filter(
    (r) =>
      Math.abs(r.lat - best.lat) <= SAME_AREA && Math.abs(r.lng - best.lng) <= SAME_AREA,
  );
}

export default function MapScreen() {
  const { placeIconOf, categoryOf, categories } = useCategories();
  const { user } = useAuth();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<{ places: Place[] }>("/api/places");
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  // Asked for when the map opens rather than when somebody presses "I'm here
  // now", so the dot is on the map for everyone who has agreed to it.
  const { granted, locate } = useMyLocation();
  /// Where the map is looking, so a search knows where it is being asked from.
  /// A ref, not state: it changes on every pan, and the search should read it
  /// when somebody types rather than re-run because the map drifted a mile.
  const viewport = useRef<{ lat: number; lng: number } | null>(null);
  /// What the map can see, which is what the sheet names and counts.
  ///
  /// State rather than a ref, unlike the centre above: the heading has to
  /// redraw when you pan somewhere else. Only ever set when a pan settles, so
  /// this is one render per gesture rather than one per frame.
  const [bounds, setBounds] = useState<Bounds | null>(null);

  const [draft, setDraft] = useState<PlaceDraft | null>(null);
  /// A saved place being read rather than edited. The editor is still there,
  /// behind this screen's ⋯, and is what a new place goes straight into —
  /// there is nothing to read about somewhere not saved yet.
  const [viewing, setViewing] = useState<Place | null>(null);
  /// What was found under a long press, waiting to be chosen from.
  const [underFinger, setUnderFinger] = useState<
    { lat: number; lng: number; found: SearchResult[] } | null
  >(null);
  const [looking, setLooking] = useState(false);

  /// What is at this point, offered so you can pick one of them.
  ///
  /// `onlyIfNamed` is what separates the two gestures. Holding the map down
  /// means "put something here", so finding nothing named is still an answer:
  /// you get an empty pin to name yourself. Tapping means "what is that?", and
  /// there the honest answer to nothing being there is nothing happening — a
  /// tap on open water should not open a form.
  async function offerWhatIsHere(
    lat: number,
    lng: number,
    { onlyIfNamed = false }: { onlyIfNamed?: boolean } = {},
  ) {
    setLooking(true);
    try {
      const found = await nearbyPlaces(lat, lng, 0.08);
      if (found.length === 0) {
        if (!onlyIfNamed) setDraft({ name: "", lat, lng });
        return;
      }
      setUnderFinger({ lat, lng, found });
    } catch {
      if (!onlyIfNamed) setDraft({ name: "", lat, lng });
    } finally {
      setLooking(false);
    }
  }
  const [query, setQuery] = useState("");
  /// Status filtering lives here now the Been tab is gone: the map of
  /// everywhere you have been is the same map with everything else hidden.
  const [status, setStatus] = useState<string>("all");
  /// Categories narrow what status has already chosen, and unlike status they
  /// stack: "Food and Café" is a question somebody asks, where "Want to go and
  /// Been there" is not. Empty means all of them.
  const [cats, setCats] = useState<string[]>([]);
  /// The pin you last tapped, which the kit draws larger with its name under
  /// it. Null is the resting state — a map of pins, none of them singled out.
  const [selected, setSelected] = useState<string | null>(null);
  const carousel = useRef<FlatList<Place>>(null);
  /// Which set of matches the map has already been framed around.
  const fittedFor = useRef<string | null>(null);
  /// The places list, which used to be its own tab. A panel rather than a
  /// separate screen: it is the same places under the same filters, and the
  /// map is the thing you want behind it.
  ///
  /// Tapped open and shut rather than dragged. A drag needs a threshold, and a
  /// threshold is something to get wrong; the bar says what it does.
  const [listOpen, setListOpen] = useState(false);

  /// The other map: places the people you follow have chosen to show.
  ///
  /// Fetched when the layer is first turned on rather than with the screen.
  /// Most openings never ask for it, and it is somebody else's data — not
  /// loading it until it is wanted is both cheaper and the better default.
  const [followedOn, setFollowedOn] = useState(false);
  const [followed, setFollowed] = useState<SharedPlace[] | null>(null);
  const [followedPick, setFollowedPick] = useState<string | null>(null);

  /// The tapped one, found rather than asserted — the layer can be switched
  /// off while its card is open.
  const pickedShared =
    followedOn && followedPick ? ((followed ?? []).find((p) => p.id === followedPick) ?? null) : null;

  async function showFollowed() {
    setFollowedOn(true);
    if (followed !== null) return;
    try {
      const body = await api<{ places: SharedPlace[] }>("/api/shared-places");
      setFollowed(body.places);
    } catch {
      setFollowed([]);
    }
  }
  /// Room enough for the list to stand beside the map instead of over it.
  ///
  /// On a phone the list is a sheet you pull up, because the map is the whole
  /// screen and anything else has to borrow from it. An iPad has room for
  /// both, and a sheet dragged over a thousand points of map is a phone
  /// gesture performed on furniture that does not need it.
  const wide = useWide();

  /// Whether the list is showing. Beside the map it always is: there is no
  /// gesture to open something that was never closed.
  const showList = wide || listOpen;

  /// How much of each side belongs to the list rather than the map.
  ///
  /// Everything that floats over the map — the search field, the matches, the
  /// two round buttons, the tab bar — measures from these, so none of them
  /// ends up behind the panel whichever side it is on. Only one is ever
  /// non-zero.
  const mapRight = wide && PANEL_SIDE === "right" ? PANEL : 0;
  const mapLeft = wide && PANEL_SIDE === "left" ? PANEL : 0;
  /// Which of the four counts the list is showing. "cities" and "countries"
  /// are not filters but groupings — the question behind them is "where have I
  /// been", and the answer is a list of cities, not of restaurants.
  const [view, setView] = useState<"all" | "cities" | "countries">("all");
  /// Set by tapping a city or a country, which drills into it.
  const [within, setWithin] = useState<string | null>(null);
  /// The share sheet for that place, and what it currently covers — the map
  /// and the list follow it, so what is on screen is what the person receiving
  /// the link will open.
  const [sharing, setSharing] = useState(false);
  const [sharePreview, setSharePreview] = useState<{
    categories: string[];
    statuses: string[];
  } | null>(null);
  /// Searched as you type. The hook asks the fast geocoder while you are still
  /// typing and both of them once you stop, so nobody has to press anything to
  /// find out whether the place they mean exists.
  const { results, searching } = usePlaceSearch(query, (q, mode) =>
    searchPlaces(q, mode, null, viewport.current),
  );
  // MapView reads initialRegion once, when it mounts, and ignores it after —
  // so recomputing this cannot drag the map out from under someone who has
  // panned away.
  const initial = useMemo(() => regionFor(data?.places ?? []), [data]);

  /// Derived above the loading and error branches: hooks must run in the same
  /// order on every render, and an early return between them changes that.
  const all = useMemo(() => data?.places ?? [], [data]);

  /// How many places are still to go, which is the one count the chips carry.
  const wishlistCount = useMemo(
    () => all.filter((p) => p.status === "wishlist").length,
    [all],
  );

  const places = useMemo(() => {
    const byStatus = status === "all" ? all : all.filter((p) => p.status === status);
    const chosen =
      cats.length === 0 ? byStatus : byStatus.filter((p) => cats.includes(p.category));
    if (status !== "lived") return chosen;
    // Lived-in places read as chapters: earliest first, undated last.
    return [...chosen].sort((a, b) => {
      if (!a.livedFrom) return b.livedFrom ? 1 : 0;
      if (!b.livedFrom) return -1;
      return new Date(a.livedFrom).getTime() - new Date(b.livedFrom).getTime();
    });
  }, [all, status, cats]);

  /// Cities and countries with how many places are in each, commonest first.
  /// Shared with the website so the two cannot disagree about a number somebody
  /// might repeat out loud.
  const groups = useMemo(() => groupPlaces(all), [all]);
  const counts = groups.counts;

  /// What the list actually shows, once the view, any drill-down, and any
  /// share being composed are applied.
  ///
  /// While the sheet is open the list is the link: turning a category off takes
  /// those places out of it, which is the only way to judge whether the link
  /// says what you meant.
  const preview = sharing ? sharePreview : null;

  const listed = useMemo(() => {
    // Cities and Countries are about spread, so they keep the places you have
    // not reached yet — hiding those would empty them for anybody still
    // planning.
    const here = within
      ? places.filter((p) => p.city === within || p.country === within)
      : places;
    if (!preview) return here;

    return here.filter(
      (p) =>
        (preview.categories.length === 0 || preview.categories.includes(p.category)) &&
        (preview.statuses.length === 0 || preview.statuses.includes(p.status)),
    );
  }, [places, within, preview]);

  /// What is on screen, which is what the sheet's heading names and counts.
  ///
  /// The list follows the map rather than listing everything ever saved:
  /// panning to Kyoto should give you Kyoto without anyone choosing it from a
  /// menu. With no bounds yet — the first frame, before the map has settled —
  /// it is everything, which is also what a world view would give.
  const inFrame = useMemo(
    () => (bounds ? listed.filter((p) => inView(p, bounds)) : listed),
    [listed, bounds],
  );

  /// While matches are on the map the sheet gets out of their way. It answers
  /// "what have I saved around here", which is not the question you are asking
  /// when you are looking for somewhere new — and it was taking a third of the
  /// screen the matches needed.
  const matchesOnMap = !wide && results.length > 0 && !listOpen;

  /// The matches as one string, so effects can depend on which places were
  /// found rather than on the array that carries them.
  const resultKey = results.map((r: SearchResult) => r.id).join(",");

  const frameName = useMemo(() => viewName(inFrame, bounds), [inFrame, bounds]);
  const frameSubtitle = useMemo(
    () => viewSubtitle(inFrame, frameName, listed.length),
    [inFrame, frameName, listed.length],
  );

  /// Tapping a pin brings its card to the front of the row below.
  ///
  /// The pin says which one you mean and the card is how you open it, so the
  /// two have to agree — a highlighted pin whose card is three swipes away is
  /// a question with the answer hidden.
  useEffect(() => {
    if (!selected || showList) return;
    const index = inFrame.findIndex((p) => p.id === selected);
    if (index < 0) return;
    carousel.current?.scrollToIndex({ index, animated: true, viewPosition: 0 });
  }, [selected, showList, inFrame]);

  /// Bring the matches into view — but only when none of them is there
  /// already.
  ///
  /// Searching is usually a question about where you are standing: you have
  /// panned to the street you are on and want to know which of the four shops
  /// with this name is the one in front of you. Reframing the map then would
  /// take away the very thing you were looking at. So the map moves only when
  /// staying put would show you nothing.
  useEffect(() => {
    if (results.length === 0) {
      // A new search gets a fresh chance to move the map.
      fittedFor.current = null;
      return;
    }
    if (fittedFor.current === resultKey || !bounds) return;
    // A view this wide is not anywhere, and everything falls inside it —
    // including matches drawn far off the sides of a screen that cannot show
    // a hemisphere at once. The same threshold the heading uses to decide the
    // view has no name.
    if (bounds.span <= WORLD_SPAN && results.some((r) => inView(r, bounds))) return;

    const cluster = sameArea(results);
    if (cluster.length === 0) return;
    // Once per set of matches, whatever happens afterwards. Framing the map
    // moves the map, which is a region change, which runs this again — and
    // the second framing restarts the first one's animation from wherever it
    // had got to. The map crept toward the matches a fraction of a degree at
    // a time and never arrived.
    fittedFor.current = resultKey;

    // Framed into the strip of map you can actually see. The list of matches
    // covers the top and the sheet covers the foot, and fitting to the whole
    // frame put the pins behind the very list that was describing them.
    if (cluster.length === 1) {
      const region = regionFor(cluster);
      if (region) map.current?.animateToRegion(region, 450);
      return;
    }
    map.current?.fitToCoordinates(
      cluster.map((r) => ({ latitude: r.lat, longitude: r.lng })),
      {
        edgePadding: {
          top: insets.top + 8 + TOP_ROW_HEIGHT + 8 + RESULTS_MAX_HEIGHT + 16,
          bottom: wide ? tabBarSpace(insets.bottom) + 16 : sheetPeekHeight(insets.bottom, true) + 16,
          left: mapLeft + 40,
          right: mapRight + 40,
        },
        animated: true,
      },
    );
    // Keyed on the matches themselves rather than the array, which is a new
    // one on every render of a search that has not changed.
  }, [resultKey, results, bounds, insets.top, insets.bottom, mapLeft, mapRight, wide]);

  /// Drilling into a city moves the map to it.
  ///
  /// Keyed on the name rather than on the list, which is a new array on most
  /// renders — depending on that would re-frame the map every time anything
  /// changed, including while you were panning it yourself.
  useEffect(() => {
    if (!within) return;
    const region = regionFor(all.filter((p) => p.city === within || p.country === within));
    if (region) map.current?.animateToRegion(region, 450);
  }, [within, all]);

  if (loading && !data) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator />
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.centre}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }


  return (
    <View style={styles.fill}>
      {/* A long press that does nothing for a second reads as a press that
          missed. */}
      {looking && (
        <View style={[styles.looking, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <ActivityIndicator />
          <Text style={{ color: palette.muted, fontSize: 13 }}>Looking at what&apos;s there…</Text>
        </View>
      )}

      {/* Keyed for the same reason the trip's item editor is: it stays
          mounted and decides for itself whether to draw, so without a key
          every field keeps the value it was first given — and a place opened
          for editing would show none of its own. */}
      <PlaceEditor
        key={draft ? (draft.id ?? `new-${draft.lat},${draft.lng}`) : "closed"}
        draft={draft}
        onClose={() => setDraft(null)}
        onSaved={reload}
      />

      {/* Somebody else's pin, tapped. Over the map like the other sheets, and
          dismissed the same way. */}
      {pickedShared && (
        <View style={[styles.sharedSheet, { paddingBottom: insets.bottom + 16 }]}>
          <SharedPlaceCard place={pickedShared} onClose={() => setFollowedPick(null)} />
        </View>
      )}

      {/* Said rather than left as a chip that appears to do nothing. Sharing is
          off until somebody turns it on, so an empty layer is the ordinary
          case rather than a fault. */}
      {followedOn && followed !== null && followed.length === 0 && (
        <View
          style={[
            styles.sharedSheet,
            styles.sharedEmpty,
            { backgroundColor: palette.surface, borderColor: palette.border, bottom: insets.bottom + 90 },
          ]}
        >
          <Text style={[type.meta, { color: palette.muted }]}>
            Nobody you follow is sharing places yet. It stays off until somebody
            turns it on, in their settings.
          </Text>
        </View>
      )}

      <PlaceDetail
        // Keyed on the place so opening a different one starts fresh rather
        // than carrying the last one's status and stars for a render.
        key={viewing?.id}
        place={viewing}
        onClose={() => setViewing(null)}
        onChanged={reload}
        onEdit={(place) => {
          setViewing(null);
          setDraft(placeToDraft(place));
        }}
      />

      {/* What was found under a long press. A sheet rather than an alert: the
          answer is a list with icons and addresses, and an alert would flatten
          it into a paragraph. */}
      <Modal
        visible={underFinger !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setUnderFinger(null)}
      >
        <View style={[styles.hereSheet, { backgroundColor: palette.background }]}>
          <View style={styles.hereHead}>
            <Text style={[styles.hereTitle, { color: palette.ink }]}>What&apos;s here?</Text>
            <Pressable onPress={() => setUnderFinger(null)} hitSlop={8}>
              <Text style={{ color: palette.muted, fontSize: 15 }}>Close</Text>
            </Pressable>
          </View>

          <ScrollView>
            {(underFinger?.found ?? []).map((r: SearchResult) => (
              <Pressable
                key={r.id}
                style={[styles.hereRow, { borderColor: palette.border }]}
                onPress={() => {
                  setUnderFinger(null);
                  setDraft({
                    name: r.name,
                    lat: r.lat,
                    lng: r.lng,
                    category: r.category,
                    address: r.address,
                    city: r.city,
                    country: r.country,
                    countryCode: r.countryCode,
                  });
                }}
              >
                <Text style={{ fontSize: 18 }}>{unfiled(r.category, categories).icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: palette.ink, fontSize: 15 }} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text style={{ color: palette.muted, fontSize: 12 }} numberOfLines={1}>
                    {r.address ?? r.city ?? ""}
                  </Text>
                </View>
              </Pressable>
            ))}

            {/* Still an option: not everything worth remembering is a place
                anybody has named. */}
            <Pressable
              style={[styles.hereRow, { borderColor: palette.border }]}
              onPress={() => {
                const at = underFinger;
                setUnderFinger(null);
                if (at) setDraft({ name: "", lat: at.lat, lng: at.lng });
              }}
            >
              <Text style={{ fontSize: 18 }}>📌</Text>
              <Text style={{ color: palette.accentText, fontSize: 15 }}>
                None of these — just drop a pin
              </Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <MapView
        ref={map}
        style={styles.fill}
        // Only while looking at somewhere in particular — roughly a country
        // across. Wider than that and the centre of the view is a point in the
        // ocean nobody is thinking about.
        onRegionChangeComplete={(r) => {
          const span = Math.max(r.latitudeDelta, r.longitudeDelta);
          viewport.current =
            span <= 8 ? { lat: r.latitude, lng: r.longitude } : null;
          setBounds({
            north: r.latitude + r.latitudeDelta / 2,
            south: r.latitude - r.latitudeDelta / 2,
            east: r.longitude + r.longitudeDelta / 2,
            west: r.longitude - r.longitudeDelta / 2,
            span,
          });
        }}
        initialRegion={initial}
        showsUserLocation={granted}
        // Long press rather than tap: a tap is how you dismiss things and pan,
        // and acting every time someone touches the map is maddening.
        //
        // It asks what is actually there before offering a blank pin. Apple
        // draws the restaurants and museums right there on the map, and having
        // to type the name of the thing you are pressing on is a strange way to
        // save it. The app cannot be told which label was pressed — that only
        // reaches Google's maps on iOS, not Apple's — so it asks what stands
        // within eighty metres of the point instead, which is the same question
        // from the other end.
        // A tap on the map is how you get back to it. Nothing is added on a
        // plain tap — that is what the long press below is for — but the
        // keyboard goes away, because a finger on the map means "I am done
        // typing" and there was previously nothing that meant that.
        onPress={(e) => {
          // A tap on a pin reaches the map as well as the marker, and the two
          // handlers would otherwise race: the marker selects the place and
          // this would put it straight back down.
          if (e.nativeEvent.action === "marker-press") return;

          // A tap that puts the keyboard away is only that. So is a tap while
          // something is selected — that one means "never mind".
          if (Keyboard.isVisible()) {
            Keyboard.dismiss();
            return;
          }
          if (selected) {
            setSelected(null);
            return;
          }

          // Otherwise it is the question a long press asks: what is there?
          //
          // Tapping the restaurant is what anybody tries first, and holding it
          // down is what nobody guesses. Apple draws its own label for the
          // place and the map library never says when one is tapped — only its
          // Google implementation does — so this asks about the point instead
          // and offers whatever is named there.
          const { latitude, longitude } = e.nativeEvent.coordinate;
          void offerWhatIsHere(latitude, longitude, { onlyIfNamed: true });
        }}
        onLongPress={(e) => {
          const { latitude, longitude } = e.nativeEvent.coordinate;
          void offerWhatIsHere(latitude, longitude);
        }}
      >
        {/* The map shows what the list shows — including when the list has
            been narrowed to one city. It used to show every pin regardless,
            so drilling into Kyoto gave you a list of Kyoto over a map of
            everywhere, and the two disagreed about what you were looking at. */}
        {listed.map((place) => (
          <Marker
            key={place.id}
            coordinate={{ latitude: place.lat, longitude: place.lng }}
            onPress={() => setSelected(place.id)}
            // Keeps the chosen pin, and its name, above its neighbours.
            zIndex={selected === place.id ? 2 : 1}
          >
            {followedOn &&
          (followed ?? []).map((place) => (
            <Marker
              key={`shared-${place.id}`}
              coordinate={{ latitude: place.lat, longitude: place.lng }}
              onPress={() => setFollowedPick(place.id)}
              zIndex={3}
            >
              {/* One colour for the whole layer rather than each place's
                  category, so a glance says which pins are yours and which
                  are somebody's recommendation. The glyph still says what
                  the place is. */}
              <View style={styles.pinBox}>
                <View style={[styles.pin, { backgroundColor: PAINT.sun }]}>
                  <Text style={styles.pinGlyph}>{place.emoji ?? "📍"}</Text>
                </View>
              </View>
            </Marker>
          ))}

        {/* The kit's pin, and the website's: the category's colour filling
                the disc with a white ring round it.

                This used to be the other way about — a pale disc with a ring
                coloured by status — so the same saved place was two different
                pictures depending on whether you opened it here or on the
                website. Status is what the chips above filter by, which is
                where that question gets answered now. */}
            <View style={styles.pinBox}>
              <View
                style={[
                  styles.pin,
                  { backgroundColor: categoryOf(place.category).color },
                  selected === place.id && styles.pinSelected,
                ]}
              >
                <Text
                  style={[styles.pinGlyph, selected === place.id && styles.pinGlyphSelected]}
                >
                  {placeIconOf(place)}
                </Text>
              </View>
            </View>

            {/* The pin's name, which the kit draws as a pill beside it. A
                callout rather than more marker: MapKit keeps it the right way
                up and on screen at the edges, and — the reason this is not
                drawn in the marker itself — it may overhang the pin, where
                anything inside the marker's own view is clipped to it.

                A label and nothing more. Opening the place is the card's job
                in the sheet below, because a tooltip callout's press does not
                reach React on iOS. */}
            <Callout tooltip>
              {/* The fixed width is the callout's, not the pill's. MapKit
                  measures a custom callout against the marker it belongs to
                  and would otherwise squeeze this into 44 points and clip the
                  name to one letter; the pill centres itself inside it. */}
              <View style={styles.pinCallout}>
                <View style={[styles.pinLabel, { backgroundColor: palette.surface }]}>
                  <Text style={[type.metaStrong, { color: palette.ink }]} numberOfLines={1}>
                    {place.name}
                  </Text>
                </View>
              </View>
            </Callout>
          </Marker>
        ))}

        {/* What the search found, on the map rather than only in the list.
            
            The list answers "which of these is it" with names and addresses,
            which is no help at all when a chain has four branches in one
            district and every one of them is called the same thing. Where they
            are is the thing that tells them apart, so they are drawn where
            they are, and tapping one offers to save that one.
            
            Sun rather than the category's colour: these are not saved places
            and should not be dressed as them — it is the colour of the button
            that adds things. */}
        {results.map((r: SearchResult, n: number) => (
          <Marker
            key={`found-${r.id}`}
            coordinate={{ latitude: r.lat, longitude: r.lng }}
            // Above the saved pins: these are what you are looking at now, and
            // a match hidden behind somewhere you saved last year is a match
            // you cannot tap.
            zIndex={4}
          >
            <View style={styles.pinBox}>
              <View style={[styles.pin, { backgroundColor: palette.accent }]}>
                <Text
                  maxFontSizeMultiplier={1.5}
                  style={[styles.foundNumber, { color: palette.onAccent }]}
                >
                  {n + 1}
                </Text>
              </View>
            </View>

            {/* Pressing a pin names it, and nothing more.

                Saving is done from the numbered row in the list. A callout of
                our own takes no presses on iOS, and the system's — which does
                — saved a different match from the one it was showing, for
                reasons I could not pin down. A wrong place saved silently is
                worse than a second tap. */}
            <Callout tooltip>
              <View style={styles.pinCallout}>
                <View style={[styles.pinLabel, { backgroundColor: palette.surface }]}>
                  <Text style={[type.metaStrong, { color: palette.ink }]} numberOfLines={1}>
                    {r.name}
                  </Text>
                </View>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      {/* iOS draws no button of its own for this, and "where am I among my
          pins" is the question a saved map exists to answer while you are out
          in the city. */}
      <Pressable
        onPress={async () => {
          const here = await locate();
          if (!here) return;
          map.current?.animateCamera({
            center: { latitude: here.lat, longitude: here.lng },
          });
        }}
        style={[
          styles.findMe,
          {
            right: mapRight + 16,
            // Beside the map the list no longer covers its foot, so the only
            // thing to clear down there is the bar.
            bottom: wide
              ? tabBarSpace(insets.bottom) + 14
              : sheetPeekHeight(insets.bottom, matchesOnMap) + 14,
          },
        ]}
        accessibilityLabel="Show where I am"
      >
        {/* Drawn rather than the supplied artwork, which baked its own pale
            tile into the image: on a dark map that was a white square, and it
            could not take the palette because it was a photograph of a button
            rather than a button. */}
        <Glass radius={FIND_ME_SIZE / 2} style={styles.findMeGlass}>
          <NavigationArrowIcon size={22} color={palette.ink} />
        </Glass>
      </Pressable>


      {/* The search field and the avatar share the top line, which is why the
          field stops short of the right edge. There is no title bar above
          them: the map runs to the top of the screen and this floats on it. */}
      <View style={[styles.topRow, { top: insets.top + 8, left: mapLeft + 12, right: mapRight + 12 }]}>
        <Glass style={styles.searchBar} radius={26}>
          <MagnifyingGlassIcon size={20} color={palette.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => Keyboard.dismiss()}
            returnKeyType="search"
            placeholder="Search places or anywhere"
            placeholderTextColor={palette.muted}
            style={[type.body, { flex: 1, color: palette.ink }]}
          />
          {searching && <ActivityIndicator />}
          {/* The way back to the map. Without it the keyboard covers half the
              screen with no gesture that closes it, and the only escape from
              a search is to have typed something worth tapping. */}
          {query.length > 0 && !searching && (
            <Pressable
              onPress={() => {
                setQuery("");
                Keyboard.dismiss();
              }}
              hitSlop={10}
              accessibilityLabel="Clear the search"
            >
              <Text style={{ color: palette.muted, fontSize: 17 }}>✕</Text>
            </Pressable>
          )}
        </Glass>

        {/* Where "You" went when the tab bar came down to four. A face is a
            better door to your own account than a fifth icon competing with
            the four places you actually move between. */}
        <Pressable
          onPress={() => router.push("/account")}
          accessibilityLabel="You"
          style={styles.avatarHit}
        >
          {user?.image ? (
            <Image source={{ uri: user.image }} style={styles.avatar} />
          ) : (
            <View
              style={[
                styles.avatar,
                styles.avatarBlank,
                { backgroundColor: palette.brandSurface },
              ]}
            >
              <Text style={[type.item, { color: palette.ink }]}>
                {(user?.name ?? user?.username ?? "?").trim().charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {/* One row, two kinds of filter.
          
          Status comes first and picks one — a place is either somewhere you
          want to go or somewhere you have been, never both. Categories follow
          and stack, because "food and cafés" is a question somebody asks. The
          two are told apart by the icons: the status chips carry theirs, the
          category chips are bare, which is how the kit draws them. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={[
          styles.chipScroll,
          {
            top: insets.top + 8 + TOP_ROW_HEIGHT + 10,
            // The row everything else on this screen already knew about and
            // this one did not: it is a scroller pinned to both edges, so
            // with the list beside the map its chips ran underneath it and a
            // half-chip sat at the seam.
            left: mapLeft + 12,
            right: mapRight + 12,
          },
        ]}
        contentContainerStyle={styles.chipRow}
      >
        {/* The other map, beside the filters for this one. It answers a
            different question — not "what have I saved" but "has anybody I
            follow been near here" — which is a question people have while
            standing somewhere, so it is a chip rather than something in a
            menu. */}
        <Pressable onPress={() => (followedOn ? setFollowedOn(false) : void showFollowed())}>
          <Glass
            radius={999}
            style={[
              styles.statusChip,
              followedOn && { backgroundColor: PAINT.sun, borderColor: PAINT.sun },
            ]}
          >
            <Text style={{ fontSize: 15 }}>👣</Text>
            <Text
              style={[type.metaStrong, { color: followedOn ? palette.onAccent : palette.ink }]}
            >
              Followed
            </Text>
          </Glass>
        </Pressable>

        {(
          [
            ["all", "All", 0, null],
            ["wishlist", "Want to go", wishlistCount, WantToGoIcon],
            ["visited", "Been there", 0, BeenIcon],
            ["lived", "Lived", 0, LivedIcon],
          ] as const
        ).map(([id, label, count, Icon]) => {
          const on = status === id;
          return (
            <Pressable key={id} onPress={() => setStatus(id)}>
              <Glass
                radius={999}
                style={[
                  styles.statusChip,
                  on && { backgroundColor: palette.primary, borderColor: palette.primary },
                ]}
              >
                {Icon && <Icon size={17} color={on ? palette.onPrimary : palette.ink} />}
                <Text
                  style={[type.metaStrong, { color: on ? palette.onPrimary : palette.ink }]}
                >
                  {label}
                </Text>
                {/* The boards put the number on the one chip it means
                    something for: how many places are still to go. */}
                {count > 0 && (
                  <View style={[styles.chipCount, { backgroundColor: palette.accent }]}>
                    <Text
                      maxFontSizeMultiplier={1.5}
                      style={[type.meta, styles.chipCountText, { color: palette.onAccent }]}
                    >
                      {count}
                    </Text>
                  </View>
                )}
              </Glass>
            </Pressable>
          );
        })}

        {/* Only the categories somebody has actually saved something in. A row
            of ten filters where seven of them empty the map is a row of ten
            ways to be disappointed. */}
        {categories
          .filter((c) => all.some((p) => p.category === c.id))
          .map((c) => {
            const on = cats.includes(c.id);
            return (
              <Pressable
                key={c.id}
                onPress={() =>
                  setCats((chosen) =>
                    chosen.includes(c.id)
                      ? chosen.filter((x) => x !== c.id)
                      : [...chosen, c.id],
                  )
                }
              >
                <Glass
                  radius={999}
                  style={[
                    styles.statusChip,
                    on && { backgroundColor: palette.primary, borderColor: palette.primary },
                  ]}
                >
                  <Text
                    style={[type.metaStrong, { color: on ? palette.onPrimary : palette.ink }]}
                  >
                    {c.label}
                  </Text>
                </Glass>
              </Pressable>
            );
          })}
      </ScrollView>

      {results.length > 0 && (
        <ScrollView
          style={[
            styles.results,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
              top: insets.top + 8 + TOP_ROW_HEIGHT + 8,
              left: mapLeft + 12,
              right: mapRight + 12,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {results.map((r: SearchResult, n: number) => (
            <Pressable
              key={r.id}
              onPress={() => {
                setQuery("");
                // Before the editor opens, not after: a keyboard raised by the
                // search has nothing to do with the sheet that follows it, and
                // arrives on top of it.
                Keyboard.dismiss();
                setDraft(draftFromResult(r));
              }}
              style={[styles.result, { borderBottomColor: palette.border }]}
            >
              {/* The same number as its pin. Four branches of one chain are
                  four identical rows, and the only thing that tells them
                  apart is where they are — so the row carries the mark that
                  points at the map, and the map carries the mark that points
                  back. Either end saves it. */}
              <View style={[styles.resultNumber, { backgroundColor: palette.accent }]}>
                <Text
                  maxFontSizeMultiplier={1.5}
                  style={[styles.foundNumber, { color: palette.onAccent }]}
                >
                  {n + 1}
                </Text>
              </View>
              <View style={styles.resultBody}>
                <Text style={{ color: palette.ink, fontSize: 15 }} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text style={{ color: palette.muted, fontSize: 12 }} numberOfLines={1}>
                  {r.context}
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <View
        style={[
          wide ? styles.panel : styles.sheet,
          { backgroundColor: palette.surface, borderColor: palette.border },
          wide
            ? { paddingTop: insets.top, paddingBottom: insets.bottom }
            : {
                // The floating tab bar sits over the foot of this sheet, so
                // the sheet keeps its own room underneath: without it the
                // collapsed handle poked out below the bar and read as a
                // second bar.
                paddingBottom: tabBarSpace(insets.bottom),
                maxHeight:
                  (matchesOnMap ? SHEET_SHUT : SHEET_PEEK) + tabBarSpace(insets.bottom),
              },
          !wide && listOpen && styles.sheetOpen,
        ]}
      >
        {/* Nothing to grab when nothing can be dragged. */}
        {!wide && (
          <Pressable onPress={() => setListOpen((open) => !open)} style={styles.handle}>
            <View style={[styles.grabber, { backgroundColor: palette.border }]} />
          </Pressable>
        )}

        {/* Closed, the sheet is a caption for the map: what you are looking
            at, how much of it you have saved, and the first few of them. It
            used to read "Show list", which named the gesture rather than
            saying anything about the place under it. */}
        {!showList && !matchesOnMap && (
          <>
            <Pressable onPress={() => setListOpen(true)} style={styles.peekHead}>
              <View style={styles.peekHeadText}>
                <Text style={[type.section, { color: palette.ink }]} numberOfLines={1}>
                  {frameName ?? "Your places"}
                </Text>
                <Text style={[type.meta, { color: palette.muted }]} numberOfLines={1}>
                  {frameSubtitle}
                </Text>
              </View>
              <Text style={[type.metaStrong, { color: palette.accentText }]}>See all</Text>
            </Pressable>

            {inFrame.length === 0 ? (
              <Text style={[type.meta, styles.peekEmpty, { color: palette.muted }]}>
                Nothing saved in view. Search above, or press and hold anywhere
                on the map to drop a pin.
              </Text>
            ) : (
              <FlatList
                ref={carousel}
                horizontal
                showsHorizontalScrollIndicator={false}
                data={inFrame}
                keyExtractor={(p) => p.id}
                contentContainerStyle={styles.peekRow}
                // A card can be off screen when its pin is tapped, and
                // scrollToIndex needs to be told how wide one is to reach it
                // without having measured it first.
                getItemLayout={(_, index) => ({
                  length: CARD_WIDTH + 12,
                  offset: (CARD_WIDTH + 12) * index,
                  index,
                })}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => setViewing(item)}
                    style={styles.card}
                  >
                    <PlaceThumb
                      icon={placeIconOf(item)}
                      color={categoryOf(item.category).color}
                      photoUrl={item.photoUrl}
                      size={CARD_PHOTO_HEIGHT}
                      width={CARD_WIDTH}
                    />
                    <Text
                      style={[type.item, styles.cardName, { color: palette.ink }]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <Text style={[type.meta, { color: palette.muted }]} numberOfLines={1}>
                      {categoryOf(item.category).icon} {categoryOf(item.category).label}
                    </Text>
                  </Pressable>
                )}
              />
            )}
          </>
        )}

        {showList && (
          <>
            <Text style={[type.title, styles.sheetTitle, { color: palette.ink }]}>
              Your places
            </Text>

            {/* Want to go, Been there, Lived — one segmented control rather
                than a row of chips, because these three are one question with
                one answer, and the boards draw them that way. The count sits
                on the label: how many are still to go is the thing somebody
                came to the list for. */}
            <View style={[styles.segmented, { backgroundColor: palette.brandSurface }]}>
              {(
                [
                  ["all", "All", counts.total],
                  ["wishlist", "Want to go", wishlistCount],
                  ["visited", "Been there", counts.been],
                  ["lived", "Lived", 0],
                ] as const
              ).map(([id, label, n]) => {
                const on = status === id;
                return (
                  <Pressable
                    key={id}
                    onPress={() => setStatus(id)}
                    style={[
                      styles.segment,
                      on && { backgroundColor: palette.surface },
                    ]}
                  >
                    <Text
                      style={[
                        type.metaStrong,
                        { color: on ? palette.ink : palette.muted },
                      ]}
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                    {n > 0 && (
                      <Text style={[type.meta, { color: palette.muted }]}>{n}</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>

            {/* The counts are the way into the list, not a caption above it.
                Places and Been filter it; Cities and Countries regroup it,
                because "3 countries" is answered by naming them. */}
            <View style={styles.tiles}>
              {(
                [
                  ["all", counts.total, "Places"],
                  ["been", counts.been, "Been"],
                  ["cities", counts.cities, "Cities"],
                  ["countries", counts.countries, "Countries"],
                ] as const
              ).map(([id, n, label]) => {
                const on = id !== "been" && view === id;
                return (
                  <Pressable
                    key={id}
                    // Been is the odd one out: the other three regroup the
                    // list below, and this opens the map of everywhere you
                    // have been. It used to filter the list to visited and
                    // lived, which the status chips above it already do.
                    onPress={() => {
                      if (id === "been") {
                        router.push("/been");
                        return;
                      }
                      setView(id);
                      setWithin(null);
                    }}
                    style={[
                      styles.tile,
                      { backgroundColor: palette.background, borderColor: palette.border },
                      on && { borderColor: palette.primary },
                    ]}
                  >
                    <Text style={[styles.tileNumber, { color: palette.ink }]}>{n}</Text>
                    <Text
                      style={{ fontSize: 11, color: on ? palette.accentText : palette.muted }}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {within && (
              <View style={styles.backRow}>
                <Pressable onPress={() => setWithin(null)} style={styles.back}>
                  <Text style={{ color: palette.accentText, fontSize: 13 }}>
                    ← Everything in {within}
                  </Text>
                </Pressable>
                {/* Looking at one city is the moment somebody might want to
                    hand it to a friend who is going there. */}
                <Pressable
                  onPress={() => {
                    setSharing(true);
                    setSharePreview({ categories: [], statuses: ["visited", "lived"] });
                  }}
                  style={styles.back}
                  hitSlop={8}
                >
                  <Text style={{ color: palette.accentText, fontSize: 13 }}>Share</Text>
                </Pressable>
              </View>
            )}

            {within && sharing && (
              <ShareArea
                area={within}
                // Everything saved here, before the sheet's own filtering —
                // the sheet decides what the link contains and shows it.
                places={all.filter((p) => p.city === within || p.country === within)}
                onPreview={setSharePreview}
                onClose={() => {
                  setSharing(false);
                  setSharePreview(null);
                }}
              />
            )}

            {(view === "cities" || view === "countries") && !within ? (
              <FlatList
                // Distinct from the places list below. Both sit in the same
                // slot, so without separate identities React reuses one list
                // across the switch and keeps its scroll offset — you tap a
                // country you scrolled down to, and its places open already
                // scrolled past the end, which looks like nothing is there.
                key="groups"
                style={wide ? styles.fill : undefined}
                data={view === "cities" ? groups.cities : groups.countries}
                keyExtractor={(g) => g.name}
                refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
                ListEmptyComponent={
                  <Text style={[styles.listEmpty, { color: palette.muted }]}>
                    Save a place and the city it is in appears here.
                  </Text>
                }
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => setWithin(item.name)}
                    style={[styles.row, { borderBottomColor: palette.border }]}
                  >
                    <Text style={styles.rowGlyph}>{view === "cities" ? "🏙️" : "🌍"}</Text>
                    <Text style={[styles.rowName, { flex: 1, color: palette.ink }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={{ color: palette.muted, fontSize: 13 }}>
                      {item.count} {item.count === 1 ? "place" : "places"}
                    </Text>
                  </Pressable>
                )}
              />
            ) : (
              <FlatList
                key={`places-${view}-${within ?? "all"}`}
                style={wide ? styles.fill : undefined}
                data={listed}
                keyExtractor={(p) => p.id}
                contentContainerStyle={{ paddingBottom: tabBarSpace(insets.bottom) }}
                refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
                ListHeaderComponent={<FirstSteps />}
                // He explains the map only when there is no map to explain.
                // The same list is empty for a much more ordinary reason —
                // panning somewhere you have not saved anything — and telling
                // somebody with four hundred places how to start their map is
                // how a helpful character becomes a nag.
                ListEmptyComponent={
                  places.length === 0 ? (
                    <OttoSays topic="noPlaces" />
                  ) : (
                    <Text style={[styles.listEmpty, { color: palette.muted }]}>
                      Nothing here yet.
                    </Text>
                  )
                }
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => setViewing(item)}
                    style={[styles.row, { borderBottomColor: palette.border }]}
                  >
                    <PlaceThumb
                      photoUrl={item.photoUrl}
                      icon={placeIconOf(item)}
                      color={categoryOf(item.category).color}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[type.item, { color: palette.ink }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      {/* What it is and what you said about it. The city is
                          the fallback rather than the default: in a list
                          already grouped by city, repeating it on every row
                          says nothing. */}
                      <Text style={[type.meta, { color: palette.muted }]} numberOfLines={1}>
                        {[categoryOf(item.category).label, item.notes?.trim()]
                          .filter(Boolean)
                          .join(" · ") ||
                          [item.city, item.country].filter(Boolean).join(", ") ||
                          "—"}
                      </Text>
                      {item.status === "lived" && item.livedFrom && (
                        <Text style={[type.meta, { color: palette.muted }]}>
                          {year(item.livedFrom)}–{item.livedTo ? year(item.livedTo) : "now"}
                        </Text>
                      )}
                    </View>
                    {/* Stars on the right, as the boards have it. The status
                        mark only while the list is unfiltered — once you have
                        chosen "Want to go", every row is one, and a column of
                        identical marks is noise. */}
                    {item.rating ? <Stars value={item.rating} /> : null}
                    {status === "all" && (
                      <StatusIcon
                        status={item.status}
                        size={16}
                        color={item.status === "wishlist" ? palette.accentText : palette.muted}
                      />
                    )}
                  </Pressable>
                )}
              />
            )}
          </>
        )}
      </View>

      {/* The kit's round Sun button, beside the tab bar.

          It asks the same question a long press does — what is at this point —
          but about the middle of what you are looking at, which is where you
          have just panned to. A "+" that opened an empty form would make you
          type the name of the thing already under your thumb. */}
      <Pressable
        onPress={async () => {
          const camera = await map.current?.getCamera();
          if (!camera) return;
          void offerWhatIsHere(camera.center.latitude, camera.center.longitude);
        }}
        style={[
          styles.fab,
          { bottom: fabBottom(insets.bottom), right: mapRight + 16, backgroundColor: palette.accent },
        ]}
        accessibilityLabel="Add a place here"
      >
        <Text style={[styles.fabGlyph, { color: palette.onAccent }]}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { color: SEMANTIC.danger, padding: 24, textAlign: "center" },
  pin: {
    width: PIN,
    height: PIN,
    borderRadius: PIN / 2,
    borderWidth: 2.5,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    // Softer and greener than black, as on the website: a hard black shadow
    // under every pin reads as an effect rather than as depth.
    shadowColor: "#12322B",
    shadowOpacity: 0.28,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  pinGlyph: { fontSize: 16, lineHeight: 19 },
  /// The disc alone, at a fixed size whether or not it is the chosen one.
  ///
  /// react-native-maps anchors a custom marker on the middle of its view, so
  /// anything that changes that view's size moves the pin off the place it is
  /// marking. The caption is positioned out of the flow below for the same
  /// reason — laid out normally it widened the box and slid the pin sideways.
  pinBox: {
    width: PIN_BOX,
    height: PIN_BOX,
    alignItems: "center",
    justifyContent: "center",
  },
  /// Grows inside the box rather than growing the box, so the pin stays on
  /// the place it marks.
  pinSelected: {
    width: PIN_SELECTED,
    height: PIN_SELECTED,
    borderRadius: PIN_SELECTED / 2,
    borderWidth: 3,
    shadowOpacity: 0.36,
    shadowRadius: 9,
  },
  pinGlyphSelected: { fontSize: 22, lineHeight: 26 },
  pinCallout: { width: PIN_CALLOUT_WIDTH, alignItems: "center" },
  pinLabel: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    maxWidth: PIN_CALLOUT_WIDTH,
    shadowColor: "#12322B",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  sharedSheet: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 0,
    zIndex: 30,
  },
  sharedEmpty: { borderWidth: 1, borderRadius: 12, padding: 12 },
  /// Above the resting sheet, which owns the foot of the map.
  findMe: { position: "absolute", right: 16 },
  fab: {
    position: "absolute",
    right: 16,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#12322B",
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  fabGlyph: { fontSize: 30, lineHeight: 34, fontWeight: "400" },
  findMeGlass: {
    width: FIND_ME_SIZE,
    height: FIND_ME_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  topRow: {
    position: "absolute",
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchBar: {
    flex: 1,
    height: TOP_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
  },
  avatarHit: { padding: 2 },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 2,
    borderColor: "#fff",
  },
  avatarBlank: { alignItems: "center", justifyContent: "center" },
  /// Scrolls rather than wraps: the categories make this longer than the
  /// screen, and a second line of chips would eat the map.
  chipScroll: { position: "absolute" },
  chipRow: { flexDirection: "row", gap: 6 },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  /// The count on "Want to go": Sun, carrying Ink, as the kit has it.
  chipCount: {
    minWidth: 20,
    height: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  chipCountText: { fontSize: 11, lineHeight: 14 },
  looking: {
    position: "absolute",
    top: 104,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    zIndex: 10,
  },
  hereSheet: { flex: 1, paddingHorizontal: 18, paddingTop: 18 },
  hereHead: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  hereTitle: { flex: 1, fontSize: 18, fontWeight: "600" },
  hereRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
  },
  results: {
    position: "absolute",
    left: 12,
    right: 12,
    maxHeight: RESULTS_MAX_HEIGHT,
    borderWidth: 1,
    borderRadius: 10,
  },
  result: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultBody: { flex: 1 },
  resultNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  /// The same face and size in the pin and in the row, so the two read as one
  /// mark in two places rather than as two marks.
  foundNumber: { ...type.metaStrong, fontSize: 13, lineHeight: 16 },
  sheetTitle: { paddingHorizontal: 16, paddingBottom: 10 },
  /// One control, four segments, the chosen one raised out of the trough.
  segmented: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 3,
    borderRadius: 999,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 7,
    borderRadius: 999,
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: 72,
  },
  sheetOpen: { maxHeight: "70%" },

  /// The same list, standing beside the map rather than lying over it.
  ///
  /// A separate style rather than an override of the sheet: the two disagree
  /// about which edges they are pinned to, and composing them would leave
  /// whichever properties the other did not mention.
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: PANEL,
    ...(PANEL_SIDE === "left"
      ? { left: 0, borderRightWidth: 1 }
      : { right: 0, borderLeftWidth: 1 }),
  },
  handle: { alignItems: "center", paddingTop: 8, paddingBottom: 8 },
  peekHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  peekHeadText: { flex: 1 },
  peekEmpty: { paddingHorizontal: 16, paddingBottom: 16, lineHeight: 19 },
  peekRow: { gap: 12, paddingHorizontal: 16, paddingBottom: 4 },
  card: { width: CARD_WIDTH },
  cardName: { marginTop: 7 },
  tiles: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
  tile: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  tileNumber: { fontSize: 18, fontWeight: "600" },
  backRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { paddingHorizontal: 14, paddingBottom: 8 },
  grabber: { width: 36, height: 4, borderRadius: 2, marginBottom: 8 },
  row: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowGlyph: { fontSize: 20 },
  rowName: { fontSize: 15, fontWeight: "500" },
  rowWhere: { fontSize: 13, marginTop: 2 },
  listEmpty: { textAlign: "center", padding: 24 },
});
